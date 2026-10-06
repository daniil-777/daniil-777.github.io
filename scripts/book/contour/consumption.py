"""Reconstruct the deterministic sampler's actual exposure, without changing training."""
import json
import argparse
from pathlib import Path
import numpy as np
import torch
from model import Decoder
from shapes import POINTS


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--artifacts',type=Path,default=Path(__file__).parent)
    folder=parser.parse_args().artifacts
    report=json.loads((folder/'training-report.json').read_text())
    torch.set_num_threads(2)
    torch.manual_seed(report['seed'])
    Decoder() # Reproduce parameter initialization's RNG consumption exactly.
    seen=np.zeros(report['trainExamples'],dtype=bool)
    for _ in range(report['steps']):
        indices=torch.randint(report['trainExamples'],(report['batchSize'],))
        seen[indices.numpy()]=True
        torch.randn(report['batchSize'],POINTS,2) # The trainer's recovery noise consumes this exact RNG block.
    checkpoint=torch.load(folder/'last.pt',weights_only=False)
    rng_matches=torch.equal(torch.get_rng_state(),checkpoint['rng'])
    receipt={'scheduledExamplePresentations':report['steps']*report['batchSize'],
        'uniqueTrainingExamplesSeen':int(seen.sum()),'totalTrainingExamples':report['trainExamples'],
        'coverageFraction':float(seen.mean()),
        'finalRngMatchesTrainingCheckpoint':rng_matches,
        'method':'Exactreplay of deterministicCPUtrainingRNG: identicalseed,Decoderinitialization,torch.randintindices,torch.randnrecovery-noise perstep. Trainingattention,optimizerandevaluationconsumenoRNG.'}
    (folder/'training-consumption.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
    if not rng_matches: raise SystemExit('Sampler reconstruction did not match the actual checkpoint RNG.')


if __name__=='__main__': main()
