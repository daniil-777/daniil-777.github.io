"""Deterministic narrow pretraining / answer-masked fine tuning, batch-one with accumulation."""
import argparse
import json
import math
import random
import resource
import sys
import time
from dataclasses import asdict
from pathlib import Path
import torch
import torch.nn.functional as F
from model import TinyDecoder, load_checkpoint
from tokenizer import Tokenizer


def examples(rows, tokenizer, pretraining=False):
    output, rejected = [], 0
    for row in rows:
        if pretraining:
            if not row.get('publicAllowed') or not row.get('rights'):
                raise ValueError('Pretraining requires licensed/public-allowed provenance for every input row.')
            sequence = [1] + tokenizer.encode(row['text']) + [2]
            for start in range(0, len(sequence) - 1, 255):
                piece = sequence[start:start + 256]
                if len(piece) > 1:
                    output.append((piece, 1))
            continue
        prompt, included = tokenizer.prompt(row)
        answer = tokenizer.encode(row['answer']) + [2]
        if len(answer) > 64 or not row['abstain'] and not set(row['supportedFactIds']) <= set(included):
            rejected += 1
            continue
        output.append((prompt + answer, len(prompt)))
    return output, rejected


def loss(model, example, device):
    sequence, prompt_length = example
    tokens = torch.tensor([sequence[:-1]], dtype=torch.long, device=device)
    labels = torch.tensor(sequence[1:], dtype=torch.long, device=device)
    labels[:prompt_length - 1] = -100  # Source/question/control tokens do not receive answer loss.
    positions = torch.arange(tokens.shape[1], device=device)[None]
    logits, _ = model(tokens, positions, torch.ones_like(tokens, dtype=torch.float32), model.empty_cache(device))
    return F.cross_entropy(logits[0], labels, ignore_index=-100)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('stage', choices=['pretrain', 'finetune'])
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--resume', type=Path)
    p.add_argument('--base', type=Path)
    a = p.parse_args()
    c = json.loads(a.config.read_text())
    seed = c.get('seed', 20261005)
    random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(c.get('cpuThreads', 2))
    device = c.get('device', 'cpu')
    if device == 'mps' and not torch.backends.mps.is_available():
        raise SystemExit('MPS unavailable; select cpu explicitly in configuration.')
    if c.get('microbatch', 1) != 1:
        raise SystemExit('The exported batch-one architecture uses microbatch=1; increase gradientAccumulation instead.')
    tokenizer = Tokenizer.load(Path(c['tokenizer']))
    rows = [json.loads(line) for line in Path(c['dataset']).read_text().splitlines()]
    train_rows = [r for r in rows if r.get('split', 'train') == 'train']
    val_rows = [r for r in rows if r.get('split') == 'validation']
    if c.get('specialistMode'):
        train_rows = [r for r in train_rows if r.get('mode') == c['specialistMode']]
        val_rows = [r for r in val_rows if r.get('mode') == c['specialistMode']]
    train, rejected = examples(train_rows, tokenizer, a.stage == 'pretrain')
    validation, val_rejected = examples(val_rows, tokenizer, a.stage == 'pretrain')
    if not train:
        raise SystemExit('No train examples fit the complete prompt/answer budget.')
    model = TinyDecoder().to(device)
    if a.base:
        model, _ = load_checkpoint(a.base, device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=c.get('learningRate', .0008), weight_decay=c.get('weightDecay', .01), betas=(.9, .95))
    step, best, stale, curves, saved = 0, float('inf'), 0, [], None
    if a.resume:
        model, saved = load_checkpoint(a.resume, device)
        optimizer = torch.optim.AdamW(model.parameters(), lr=c.get('learningRate', .0008), weight_decay=c.get('weightDecay', .01), betas=(.9, .95))
        optimizer.load_state_dict(saved['optimizer'])
        step, best, curves = saved['step'], saved.get('bestValidationLoss', float('inf')), saved.get('curves', [])
        random.setstate(saved['randomState'])
        torch.set_rng_state(saved['torchRngState'])
    output = Path(c['output'])
    output.mkdir(parents=True, exist_ok=True)
    accumulation = c.get('gradientAccumulation', 4)
    max_steps = c.get('steps', 1000)
    warmup = c.get('warmupSteps', 50)
    start = time.monotonic()
    learned_tokens = saved.get('measurements', {}).get('learnedAnswerTokens', 0) if saved else 0
    previous_wall = saved.get('measurements', {}).get('wallSeconds', 0) if saved else 0
    order = saved.get('order', list(range(len(train)))) if saved else list(range(len(train)))
    if saved and device == 'mps' and saved.get('mpsRngState') is not None:
        torch.mps.set_rng_state(saved['mpsRngState'])
    torch.use_deterministic_algorithms(device == 'cpu')
    for step in range(step, max_steps):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        total_loss = 0
        for micro in range(accumulation):
            if (step * accumulation + micro) % len(train) == 0:
                random.shuffle(order)
            example = train[order[(step * accumulation + micro) % len(train)]]
            value = loss(model, example, device)
            (value / accumulation).backward()
            total_loss += value.item() / accumulation
            learned_tokens += len(example[0]) - example[1]
        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), c.get('gradientClip', 1.0))
        factor = min(1., (step + 1) / max(1, warmup))
        factor *= .1 + .9 * .5 * (1 + math.cos(math.pi * max(0, step - warmup) / max(1, max_steps - warmup)))
        for group in optimizer.param_groups:
            group['lr'] = c.get('learningRate', .0008) * factor
        optimizer.step()
        if (step + 1) % c.get('evaluateEvery', 50) == 0 or step + 1 == max_steps:
            model.eval()
            with torch.no_grad():
                val_loss = sum(loss(model, example, device).item() for example in validation) / len(validation) if validation else None
            measurement = {'step': step + 1, 'trainLoss': total_loss, 'validationLoss': val_loss, 'gradientNorm': float(norm), 'elapsedSeconds': time.monotonic() - start}
            curves.append(measurement)
            print(json.dumps(measurement), flush=True)
            improved = val_loss is not None and val_loss < best
            if improved:
                best, stale = val_loss, 0
            else:
                stale += 1
            saved = {'version': f'chronos-a-{a.stage}-{seed}', 'trained': True, 'stage': a.stage, 'architecture': asdict(model.config),
                     'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'step': step + 1, 'seed': seed,
                     'randomState': random.getstate(), 'torchRngState': torch.get_rng_state(), 'bestValidationLoss': best, 'order': order,
                     'mpsRngState': torch.mps.get_rng_state() if device == 'mps' else None,
                     'curves': curves, 'dataVersion': c.get('dataVersion', 'unknown'), 'tokenizerPath': c['tokenizer'],
                     'config': c, 'quality': {'releasePassed': False, 'independentReview': False},
                     'measurements': {'hardwareDevice': device, 'trainRows': len(train), 'validationRows': len(validation),
                                      'rejectedTrainBudget': rejected, 'rejectedValidationBudget': val_rejected,
                                      'learnedAnswerTokens': learned_tokens, 'wallSeconds': previous_wall + time.monotonic() - start,
                                      'answerTokensPerSecond': learned_tokens / max(.001, previous_wall + time.monotonic() - start),
                                      'peakProcessRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024),
                                      'mpsAllocatedBytes': torch.mps.current_allocated_memory() if device == 'mps' else 0,
                                      'pretrainingPerformed': a.stage == 'pretrain'}}
            torch.save(saved, output / 'last.pt')
            if improved:
                torch.save(saved, output / 'best.pt')
            (output / 'training.json').write_text(json.dumps({k: v for k, v in saved.items() if k not in ['model', 'optimizer', 'randomState', 'torchRngState', 'mpsRngState']}, indent=2) + '\n')
            if validation and stale >= c.get('earlyStoppingPatience', 5):
                print('Early stopping on held-out validation loss.', flush=True)
                break


if __name__ == '__main__':
    main()
