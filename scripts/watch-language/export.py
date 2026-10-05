"""FP32 single-session export and cached parity. Never marks a failing candidate released."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
import torch
from model import TinyDecoder, Config, load_checkpoint


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(model, path):
    model = model.cpu().eval()
    ids = torch.tensor([[1, 3, 6, 20, 21, 7, 8]])
    # Export with a nonempty cache; dynamic axis is also tested with a genuinely empty cache.
    past = torch.zeros(4, 2, 1, 2, 2, 32)
    torch.onnx.export(model, (ids, torch.arange(2, 9)[None], torch.ones(1, 9), past), str(path),
                      input_names=['input_ids', 'position_ids', 'attention_mask', 'past'],
                      output_names=['logits', 'present'], opset_version=17, dynamo=False,
                      dynamic_axes={'input_ids': {1: 'new_length'}, 'position_ids': {1: 'new_length'},
                                    'attention_mask': {1: 'total_length'}, 'past': {4: 'past_length'},
                                    'logits': {1: 'new_length'}, 'present': {4: 'total_length'}})
    graph = onnx.load(path)
    embeddings = [i for i in graph.graph.initializer if list(i.dims) == [4096, 192]]
    duplicates = [i for i in graph.graph.initializer if list(i.dims) == [192, 4096]]
    # Legacy export folds the tied projection transpose into a second initializer.
    # Replace that exact duplicate with an explicit view in the serialized reference.
    if len(embeddings) == 1 and len(duplicates) == 1:
        from onnx import numpy_helper, helper
        assert np.array_equal(numpy_helper.to_array(embeddings[0]).T, numpy_helper.to_array(duplicates[0]))
        transpose = helper.make_node('Transpose', [embeddings[0].name], [duplicates[0].name], perm=[1, 0], name='TiedOutputTranspose')
        graph.graph.initializer.remove(duplicates[0])
        graph.graph.node.insert(0, transpose)
        onnx.save(graph, path)
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    errors, continuations, fixtures = [], [], []
    for initial in ([1, 3, 6, 265, 19, 7, 8], [1, 4, 6, 220, 155, 0, 7, 8], [1, 5, 6, 264, 99, 7, 8]):
        sequence = list(initial)
        past_np = np.empty((4, 2, 1, 2, 0, 32), dtype=np.float32)
        past_pt = model.empty_cache()
        length = 0
        token = sequence
        fixture = {'inputIds': list(initial), 'paddingIndex': 5 if initial[1] == 4 else None, 'steps': []}
        for step in range(5):
            ids_np = np.array([token], dtype=np.int64)
            pos_np = np.arange(length, length + len(token), dtype=np.int64)[None]
            mask_np = np.ones((1, length + len(token)), dtype=np.float32)
            # Include a padding-mask path without requiring right padding in production.
            if initial[1] == 4:
                mask_np[0, 5] = 0
            actual, present = session.run(None, {'input_ids': ids_np, 'position_ids': pos_np, 'attention_mask': mask_np, 'past': past_np})
            with torch.no_grad():
                expected, present_pt = model(torch.from_numpy(ids_np), torch.from_numpy(pos_np), torch.from_numpy(mask_np), past_pt)
            errors.append(float(np.abs(actual - expected.numpy()).max()))
            assert np.allclose(actual, expected.numpy(), atol=2e-5, rtol=2e-4), errors[-1]
            chosen = int(actual[0, -1].argmax())
            assert chosen == int(expected[0, -1].argmax())
            if initial[1] != 4:
                with torch.no_grad():
                    uncached = model.complete(sequence)[0, -1].numpy()
                assert np.allclose(actual[0, -1], uncached, atol=2e-5, rtol=2e-4)
            continuations.append(chosen)
            fixture['steps'].append({'tokenId': chosen, 'lastLogits': actual[0, -1].tolist()})
            length += len(token)
            token = [chosen]
            sequence.append(chosen)
            past_np, past_pt = present, present_pt
        fixtures.append(fixture)
    (path.parent / 'parity-fixtures.json').write_text(json.dumps(fixtures, separators=(',', ':')) + '\n')
    # Tied parameter is represented by one initializer, with a transpose consumed by MatMul.
    embeddings = [i for i in graph.graph.initializer if list(i.dims) == [4096, 192]]
    duplicates = [i for i in graph.graph.initializer if list(i.dims) == [192, 4096]]
    return {'passed': True, 'maxLogitAbsoluteError': max(errors), 'cases': len(errors), 'cachedGreedyParity': True,
            'emptyCache': True, 'paddingMask': True, 'operators': sorted({n.op_type for n in graph.graph.node}),
            'embeddingInitializers': len(embeddings), 'transposedEmbeddingInitializers': len(duplicates),
            'tiedWeightsPreserved': len(embeddings) == 1 and len(duplicates) == 0,
            'runtimeWeightDuplication': 'ORT graph optimization may materialize the output transpose; total resident memory must be measured separately.',
            'runtime': ort.__version__, 'greedyTokenIds': continuations}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--tokenizer', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dtype', choices=['fp32'], default='fp32')
    parser.add_argument('--feasibility', action='store_true')
    args = parser.parse_args()
    torch.set_num_threads(2)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.feasibility:
        torch.manual_seed(20261005)
        model, checkpoint = TinyDecoder(), {'trained': False, 'dataVersion': 'numerical-export-only'}
    elif args.checkpoint:
        model, checkpoint = load_checkpoint(args.checkpoint)
    else:
        parser.error('Provide a trained checkpoint or explicitly request the offline numerical feasibility test.')
    path = args.output / 'model.fp32.onnx'
    parity = export(model, path)
    c = model.config
    architecture = {'layers': c.layers, 'width': c.width, 'ffn': c.ffn, 'heads': c.heads, 'kvHeads': c.kvHeads,
                    'headDim': c.headDim, 'vocab': c.vocab, 'parameters': sum(p.numel() for p in model.parameters())}
    assert architecture['parameters'] == 2361024
    quality = checkpoint.get('quality', {})
    release = checkpoint.get('trained', False) and quality.get('releasePassed', False)
    manifest = {'schemaVersion': 1, 'version': checkpoint.get('version', 'a-fp32-feasibility'),
                'releaseStatus': 'released' if release else 'experimental', 'trained': bool(checkpoint.get('trained')),
                'reason': None if release else ('The trained candidate failed held-out language gates; public inference remains disabled.' if checkpoint.get('trained') and quality.get('samples') else 'A trained candidate has not passed independently reviewed language release gates.'),
                'runtimeVersion': '1.23.0', 'dtype': 'fp32', 'contextLength': 256, 'architecture': architecture,
                'model': {'url': './model.fp32.onnx', 'sha256': sha(path), 'bytes': path.stat().st_size},
                'wasmBaseUrl': './runtime/1.23.0/', 'dataVersion': checkpoint.get('dataVersion', 'unknown'),
                'quality': quality, 'numericalParity': parity}
    if args.tokenizer:
        target = args.output / 'tokenizer.json'
        shutil.copy2(args.tokenizer, target)
        manifest['tokenizer'] = {'url': './tokenizer.json', 'sha256': sha(target), 'bytes': target.stat().st_size}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'artifactBytes': path.stat().st_size, 'architecture': architecture, 'parity': parity}))


if __name__ == '__main__':
    main()
