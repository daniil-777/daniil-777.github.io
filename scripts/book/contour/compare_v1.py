"""Independent original-four regression comparison against the previously shipped model."""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from model import Decoder, generate
from shapes import SHAPES, contour
import v1_baseline


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--artifacts',type=Path,default=Path(__file__).parent)
    parser.add_argument('--baseline',type=Path,default=Path(__file__).parent/'baseline-v1')
    args=parser.parse_args();folder=args.artifacts
    report=json.loads((folder/'training-report.json').read_text())
    model=Decoder();model.load_state_dict(torch.load(folder/'best.pt',weights_only=True));model.eval()
    old=v1_baseline.load(args.baseline)
    torch.set_num_threads(2)
    with np.load(folder/'contour-dataset.npz') as saved:
        selected=saved['test_shape']<4
        shapes=torch.from_numpy(saved['test_shape'][selected])
        styles=torch.from_numpy(saved['test_style'][selected])
        targets=saved['test_points'][selected]
    current=generate(model,shapes,styles).numpy()
    previous=v1_baseline.generate(old,shapes,styles).numpy()
    previous96=np.stack([np.stack([np.interp(np.linspace(0,1,96),np.linspace(0,1,48),path[:,axis]) for axis in range(2)],-1) for path in previous])
    comparisons={}
    for family in range(4):
        chosen=shapes.numpy()==family
        current_mse=float(np.square(current[chosen]-targets[chosen]).mean())
        previous_mse=float(np.square(previous96[chosen]-targets[chosen]).mean())
        comparisons[SHAPES[family]]={'drawings':int(chosen.sum()),'v1Interpolated96Mse':previous_mse,
            'v2Native96Mse':current_mse,'ratio':current_mse/previous_mse,
            'svg85PixelRmseV1':float(np.sqrt(previous_mse)*85),'svg85PixelRmseV2':float(np.sqrt(current_mse)*85)}
    receipt={'originalFourFamilies':comparisons,'v1Points':48,'v2Points':96,
        'comparison':'Same untouchedv2test styles; v1traces linearlyinterpolated from48to96coordinates. Extra16-familytraining affectscapacity; report observedaccuracy rather than assumingnonregression.',
        'v2Step':report['selectedStep']}
    (folder/'original-four-comparison.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))


if __name__=='__main__':main()
