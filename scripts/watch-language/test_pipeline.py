"""Offline correctness checks, not a claim of language quality."""
import unittest
import torch
from model import TinyDecoder
from tokenizer import Tokenizer, RESERVED
from train import loss
from dataset import grouped_splits, generate, pilot, validate
from pathlib import Path
from tempfile import TemporaryDirectory
import json


class PipelineTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(20261005)
        torch.set_num_threads(2)

    def test_byte_encoding(self):
        tokenizer = Tokenizer.train(['Swiss precision and mathematical conditions.'])
        for text in ['Daniil Emtsev Zürich', '∑λ 長い名前', '\n\t  <eos>']:
            self.assertEqual(tokenizer.decode(tokenizer.encode(text)), text)

    def test_exact_architecture_and_true_grouped_cache(self):
        model = TinyDecoder()
        self.assertEqual(sum(p.numel() for p in model.parameters()), 2361024)
        self.assertEqual(tuple(model.empty_cache().shape), (4, 2, 1, 2, 0, 32))
        self.assertEqual(4 * 2 * 1 * 2 * 256 * 32 * 4, 524288)

    def test_cached_decode_equals_complete_prefix(self):
        model = TinyDecoder().eval()
        sequence = [1, 3, 6, 35, 7, 8]
        with torch.no_grad():
            _, past = model(torch.tensor([sequence]), torch.arange(6)[None], torch.ones(1, 6), model.empty_cache())
            actual, _ = model(torch.tensor([[42]]), torch.tensor([[6]]), torch.ones(1, 7), past)
            expected = model.complete(sequence + [42])
        self.assertTrue(torch.allclose(actual[0, -1], expected[0, -1], atol=2e-6, rtol=2e-5))

    def test_answer_mask_and_real_weight_update(self):
        model = TinyDecoder()
        sequence = [1, 3, 6, 40, 7, 8, 100, 101, 2]
        value = loss(model, (sequence, 6), 'cpu')
        logits = model.complete(sequence[:-1])[0]
        expected = torch.nn.functional.cross_entropy(logits[5:], torch.tensor(sequence[6:]))
        self.assertTrue(torch.allclose(value, expected))
        before = model.embedding.weight.detach().clone()
        optimizer = torch.optim.AdamW(model.parameters(), lr=.001)
        value.backward()
        optimizer.step()
        self.assertFalse(torch.equal(before, model.embedding.weight))

    def test_linked_versions_and_facts_share_split(self):
        facts = [{'id': 'shared-fact', 'sourceId': 'v1'}, {'id': 'shared-fact', 'sourceId': 'v2'},
                 {'id': 'other', 'sourceId': 'other'}, {'id': 'third', 'sourceId': 'third'}]
        splits = grouped_splits(facts)
        self.assertEqual(splits['v1'], splits['v2'])

    def test_expanded_corpus_has_unique_rows_and_source_disjoint_domains(self):
        pack = json.loads((Path(__file__).resolve().parents[2] / 'public/watch/facts.v1.json').read_text())
        with TemporaryDirectory(prefix='watch-corpus-test-') as folder:
            target = Path(folder) / 'corpus.jsonl'
            stats = pilot(pack, target, 20261005)
            rows = [json.loads(line) for line in target.read_text().splitlines()]
        self.assertGreaterEqual(stats['distinctFacts'], 360)
        self.assertGreaterEqual(stats['accepted'], 2500)
        self.assertEqual(stats['rejected'], 0)
        self.assertEqual(len({r['id'] for r in rows}), len(rows))
        groups = {}
        for row in rows:
            self.assertEqual(validate(row), [])
            for kind in ['sourceGroup', 'factGroup', 'scenarioGroup']:
                identity = (kind, row[kind])
                self.assertEqual(groups.setdefault(identity, row['split']), row['split'])
        for domain, split in stats['domainSplits'].items():
            self.assertGreater(split['train'], 0, domain)
            self.assertGreater(split['test'], 0, domain)

    def test_paid_generation_disabled_before_credentials_or_requests(self):
        with self.assertRaises(SystemExit):
            generate({}, Path('/tmp/not-created-chronos-teacher.jsonl'), 0)


if __name__ == '__main__':
    unittest.main()
