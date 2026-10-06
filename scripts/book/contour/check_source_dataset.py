"""Verify that the exact saved original artwork is reproducible from current source."""
import hashlib
import argparse
import json
import time
from pathlib import Path
import numpy as np
from shapes import contour


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--artifacts',type=Path,default=Path(__file__).parent)
    folder=parser.parse_args().artifacts
    started=time.monotonic()
    splits={}
    with np.load(folder/'contour-dataset.npz') as saved:
        for split in ['train','validation','test']:
            ids,styles,points=[saved[split+'_'+key] for key in ['shape','style','points']]
            exact=0;maximum=0.
            for family,style,point in zip(ids,styles,points):
                rebuilt=contour(family,style)
                exact+=int(np.array_equal(rebuilt,point))
                maximum=max(maximum,float(np.abs(rebuilt-point).max()))
            splits[split]={'drawings':len(ids),'bitExactMatches':exact,'maximumAbsoluteCoordinateDifference':maximum}
    receipt={'splits':splits,'allExact':all(value['drawings']==value['bitExactMatches'] for value in splits.values()),
        'shapesSourceSha256':hashlib.sha256((Path(__file__).parent/'shapes.py').read_bytes()).hexdigest(),
        'elapsedSeconds':round(time.monotonic()-started,2)}
    (folder/'source-dataset-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
    if not receipt['allExact']:raise SystemExit('Source/dataset mismatch')


if __name__=='__main__':main()
