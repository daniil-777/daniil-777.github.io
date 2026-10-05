"""Package measured expanded-corpus artifacts without granting a language release."""
import argparse
import gzip
import hashlib
import json
import shutil
from tokenizer import Tokenizer
from pathlib import Path
import torch


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--training', type=Path, required=True)
    p.add_argument('--comparison-training', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--export', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--browser', type=Path)
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    for file in ['model.fp32.onnx', 'tokenizer.json', 'manifest.json']:
        shutil.copyfile(a.export / file, a.output / file)
    stats = read(a.data / 'dataset.stats.json')
    evaluation = read(a.data / 'evaluation-test-raw.json')
    comparison = read(a.data / 'validation-comparison.json')
    training = read(a.training / 'training.json')
    comparison_training = read(a.comparison_training / 'training.json')
    checkpoint = torch.load(a.checkpoint, weights_only=False, map_location='cpu')
    manifest = read(a.output / 'manifest.json')
    assert manifest['releaseStatus'] == 'experimental' and evaluation['releasePassed'] is False
    summary = {k: v for k, v in evaluation.items() if k != 'results'}
    write(a.output / 'dataset-statistics.json', stats)
    write(a.output / 'evaluation-candidate.json', summary)
    write(a.output / 'evaluation-raw.json', evaluation)
    write(a.output / 'validation-comparison.json', comparison)
    write(a.output / 'training-candidate.json', training)
    write(a.output / 'training-comparison.json', comparison_training)
    tokenizer = read(a.output / 'tokenizer.json')
    used_tokens = 265 + len(tokenizer['merges'])
    model_bytes = (a.output / 'model.fp32.onnx').stat().st_size
    # Reconstruct training provenance from the actual frozen corpus, not the later display registry.
    rows = [json.loads(line) for line in (a.data / 'dataset.jsonl').read_text().splitlines()]
    training_facts = {f['id']: f for row in rows for f in row['facts']}
    training_pack = {
        'version': stats['factPackVersion'], 'asOf': max(f['reviewedAt'] for f in training_facts.values()),
        'language': 'en', 'facts': sorted(training_facts.values(), key=lambda f: int(f['id'].split('-')[-1])),
    }
    training_pack_bytes = (json.dumps(training_pack, indent=2) + '\n').encode()
    display_pack = read(a.output.parent / 'facts.v1.json')
    display_facts = {f['id']: f for f in display_pack['facts']}
    assert set(training_facts) == set(display_facts)
    for identity, fact in training_facts.items():
        assert all(fact[key] == display_facts[identity][key] for key in ['mode', 'topic', 'text', 'answer', 'sourceId'])
    tokenization = Tokenizer.load(a.output / 'tokenizer.json')
    training_tokens, display_tokens = hashlib.sha256(), hashlib.sha256()
    for row in rows:
        def encoded(record):
            prompt, included = tokenization.prompt(record)
            return {'id': record['id'], 'split': record['split'], 'sourceGroup': record['sourceGroup'],
                    'includedFactIds': included, 'promptIds': prompt, 'answerIds': tokenization.encode(record['answer']) + [2]}
        current = {**row, 'facts': [display_facts[f['id']] for f in row['facts']]}
        training_tokens.update(json.dumps(encoded(row), sort_keys=True, separators=(',', ':')).encode() + b'\n')
        display_tokens.update(json.dumps(encoded(current), sort_keys=True, separators=(',', ':')).encode() + b'\n')
    assert training_tokens.hexdigest() == display_tokens.hexdigest()
    fingerprint = {
        'datasetVersion': stats['datasetVersion'], 'factPackVersion': stats['factPackVersion'],
        'corpusSha256': hashlib.sha256((a.data / 'dataset.jsonl').read_bytes()).hexdigest(),
        'validationSha256': hashlib.sha256((a.data / 'validation.json').read_bytes()).hexdigest(),
        'factPackSha256': hashlib.sha256(training_pack_bytes).hexdigest(),
        'factPackHashScope': 'Original fact registry embedded in the frozen training corpus, before the citation-only display correction.',
        'trainingFactPackSha256': hashlib.sha256(training_pack_bytes).hexdigest(),
        'currentDisplayFactPackVersion': display_pack['version'],
        'currentDisplayFactPackSha256': hashlib.sha256((a.output.parent / 'facts.v1.json').read_bytes()).hexdigest(),
        'tokenizedTrainingInputsAndTargetsSha256': training_tokens.hexdigest(),
        'currentDisplayConditionedInputsAndTargetsSha256': display_tokens.hexdigest(),
        'postTrainingCitationCorrection': {
            'factId': 'ai-094', 'topic': 'Jacobian vector products',
            'currentSourceUrl': 'https://docs.pytorch.org/docs/2.14/generated/torch.func.jvp.html',
            'note': 'Reference corrected after training from the beginner VJP tutorial to the specific JVP API. Answer, text, topic, mode, source-group bucket and every prompt/target token ID are unchanged. No retraining is represented by this metadata correction.',
            'independentAgentReview': True, 'independentHumanReview': False,
        },
        'tokenizerSha256': manifest['tokenizer']['sha256'],
        'splitMethod': stats['splitMethod'], 'rows': stats['accepted'],
        'originalFacts': stats['distinctFacts'], 'sourceGroups': stats['sourceGroups'],
        'promptVariantsAreIndependentFacts': False, 'sourcePassagesIngested': False,
        'independentHumanReview': False, 'teacherSpendUsd': 0,
    }
    write(a.output / 'dataset-fingerprint.json', fingerprint)
    browser = read(a.browser) if a.browser else None
    if browser:
        write(a.output / 'benchmark-browser.json', browser)
    else:
        (a.output / 'benchmark-browser.json').unlink(missing_ok=True)
    card = {
        'schemaVersion': 1, 'name': 'Smart watch expanded grounded language experiment',
        'version': manifest['version'], 'releaseStatus': manifest['releaseStatus'], 'trained': True,
        'deployment': 'Experimental model blocked before public weight/runtime downloads. Watch shows labelled source-reviewed sentences.',
        'architecture': manifest['architecture'], 'contextLength': 256, 'dtype': 'fp32',
        'training': {
            'method': 'Two fresh random-initialized answer-masked CPU runs on the expanded corpus; no pretrained model or paid teacher.',
            'seed': training['seed'], 'optimizerUpdatesPerRun': training['step'],
            'totalMeasuredOptimizerUpdates': training['step'] + comparison_training['step'],
            'selectedCheckpointStep': checkpoint['step'], 'learningRate': training['config']['learningRate'],
            'gradientAccumulation': training['config']['gradientAccumulation'],
            'device': 'CPU', 'trainRows': training['measurements']['trainRows'],
            'validationRowsWithinTokenBudget': training['measurements']['validationRows'],
            'validationRowsRejectedTokenBudget': training['measurements']['rejectedValidationBudget'],
            'testRows': stats['splits']['test'], 'acceptedRows': stats['accepted'],
            'sourceGroups': stats['sourceGroups'], 'tokenizerUsedTokens': used_tokens,
            'configuredVocabulary': 4096, 'wallSecondsSelectedRun': training['measurements']['wallSeconds'],
            'wallSecondsComparisonRun': comparison_training['measurements']['wallSeconds'],
            'pretrainingPerformed': False, 'teacherSpendUsd': 0, 'independentReview': False,
        },
        'dataset': stats, 'provenance': fingerprint,
        'selection': {
            'method': comparison['method'], 'rule': comparison['selectionRule'],
            'candidate': comparison['selected'], 'testUsedForSelection': False,
            'candidateValidation': [{k: v for k, v in r.items() if k != 'generations'} for r in comparison['results']],
        },
        'quality': summary, 'finiteSuite': evaluation['finiteSuite'],
        'numericalParity': manifest['numericalParity'], 'browserBenchmark': browser,
        'resources': {
            'modelBytes': model_bytes, 'tokenizerBytes': manifest['tokenizer']['bytes'],
            'wasmBytes': (a.output / 'runtime/1.23.0/ort-wasm-simd-threaded.wasm').stat().st_size,
            'runtimeModuleBytes': (a.output / 'runtime/1.23.0/ort-wasm-simd-threaded.mjs').stat().st_size,
            'maximumFp32KvBytes': 524288, 'incrementalResidentMemoryBytes': None,
            'mobileTested': False, 'gpuMlBytes': 0,
        },
        'rights': {
            'modelWeights': 'Original weights trained from scratch locally on original authored factual sentences; no third-party pretrained weights.',
            'factPack': 'Original short summaries with per-fact primary attribution; no source passages or complete source corpora were ingested.',
            'runtime': 'Microsoft ONNX Runtime 1.23.0, MIT; bundled LICENSE and ThirdPartyNotices.txt.',
        },
        'limits': [
            'Release failed: no independent source-entailment or clinical review; public neural generation remains disabled.',
            'Prompt variants are correlated examples; dataset growth does not multiply independent source facts.',
            'Fixed test rates and Wilson intervals describe this finite correlated suite, not population guarantees.',
            'Token-budget exclusions and tokenizer choice are reported; no broad English pretraining was performed.',
            'No FP16, INT8, INT4 or WebGPU release claim; physical mobile and total resident memory unmeasured.',
            'Earlier 34-fact evaluation uses different data and cannot establish a direct quality improvement comparison.',
        ],
        'documentation': 'https://github.com/daniil-777/daniil-777.github.io/blob/main/docs/watch-language.md',
        'teacherSpendUsd': 0,
    }
    write(a.output / 'model-card.json', card)
    # These belonged to the previous 34-fact experiment and would be stale beside new weights.
    for obsolete in ['training-initial.json', 'evaluation-familiar.json']:
        (a.output / obsolete).unlink(missing_ok=True)
    sizes = []
    for file in sorted(a.output.rglob('*')):
        if file.is_file() and file.name != 'asset-sizes.json':
            blob = file.read_bytes()
            sizes.append({'path': str(file.relative_to(a.output)), 'bytes': len(blob),
                          'gzipBytes': len(gzip.compress(blob, compresslevel=9, mtime=0)),
                          'sha256': hashlib.sha256(blob).hexdigest()})
    write(a.output / 'asset-sizes.json', {
        'version': 'chronos-language-expanded-assets-v2', 'files': sizes,
        'note': 'Artifact/gzip bytes only; these experimental weights are not fetched by public watch inference and bytes do not measure browser memory.',
    })
    print(json.dumps({'version': manifest['version'], 'files': len(sizes), 'modelBytes': model_bytes,
                      'modelSha256': manifest['model']['sha256'], 'releaseStatus': manifest['releaseStatus']}))


if __name__ == '__main__':
    main()
