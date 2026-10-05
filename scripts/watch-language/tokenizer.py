"""A compact train-only whitespace-piece byte BPE shared with TypeScript."""
import collections
import json
import re

RESERVED = ['<pad>', '<bos>', '<eos>', '<ai>', '<profile>', '<wellbeing>', '<facts>', '<question>', '<answer>']


class Tokenizer:
    def __init__(self, data):
        assert data['reserved'] == RESERVED and data['vocabularySize'] == 4096
        self.data = data
        self.merges = {tuple(pair): 265 + i for i, pair in enumerate(data['merges'])}
        self.bytes = [b''] * 9 + [bytes([i]) for i in range(256)]
        for a, b in data['merges']:
            self.bytes.append(self.bytes[a] + self.bytes[b])

    def encode(self, text):
        result = []
        for piece in re.findall(r'\s+|\S+', text):
            ids = [v + 9 for v in piece.encode('utf-8')]
            while len(ids) > 1:
                candidates = [(self.merges.get((a, b), 999999), i) for i, (a, b) in enumerate(zip(ids, ids[1:]))]
                rank, i = min(candidates)
                if rank == 999999:
                    break
                ids[i:i + 2] = [rank]
            result.extend(ids)
        return result

    def decode(self, ids):
        return b''.join(self.bytes[i] if i < len(self.bytes) else b'' for i in ids).decode('utf-8', errors='replace')

    def prompt(self, row, max_new=64):
        question = self.encode((row.get('question') or '')[:240])
        if len(question) > 64:
            raise ValueError('Question too long')
        ids = [1, RESERVED.index('<' + row['mode'] + '>'), 6]
        included = []
        for fact in row.get('facts', []):
            encoded = self.encode(fact['text'] + '\n')
            if len(ids) + len(encoded) + len(question) + 2 <= 256 - max_new:
                ids.extend(encoded)
                included.append(fact['id'])
        return ids + [7] + question + [8], included

    @classmethod
    def train(cls, texts, vocabulary=4096):
        pieces = collections.Counter(tuple(b + 9 for b in piece.encode('utf-8')) for text in texts for piece in re.findall(r'\s+|\S+', text))
        merges = []
        while len(merges) + 265 < vocabulary:
            pairs = collections.Counter()
            for piece, count in pieces.items():
                for pair in zip(piece, piece[1:]):
                    pairs[pair] += count
            if not pairs:
                break
            pair = min(pairs, key=lambda p: (-pairs[p], p))
            new_id = 265 + len(merges)
            merged = collections.Counter()
            for piece, count in pieces.items():
                output, i = [], 0
                while i < len(piece):
                    if i + 1 < len(piece) and (piece[i], piece[i + 1]) == pair:
                        output.append(new_id)
                        i += 2
                    else:
                        output.append(piece[i])
                        i += 1
                merged[tuple(output)] += count
            pieces = merged
            merges.append(list(pair))
        return cls({'schemaVersion': 1, 'vocabularySize': 4096, 'reserved': RESERVED, 'merges': merges, 'trainedSplit': 'train'})

    def save(self, path):
        path.write_text(json.dumps(self.data, separators=(',', ':')) + '\n')

    @classmethod
    def load(cls, path):
        return cls(json.loads(path.read_text()))


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.dataset.read_text().splitlines()]
    texts = [row['answer'] + ' ' + ' '.join(f['text'] for f in row['facts']) + ' ' + (row.get('question') or '') for row in rows if row['split'] == 'train']
    tokenizer = Tokenizer.train(texts)
    tokenizer.save(args.output)
    print(json.dumps({'configuredVocabulary': 4096, 'usedVocabulary': len(tokenizer.bytes), 'trainedSplit': 'train', 'trainTexts': len(texts), 'note': 'Unused vocabulary IDs remain reserved; a small corpus cannot supply 4096 useful merges.'}))
