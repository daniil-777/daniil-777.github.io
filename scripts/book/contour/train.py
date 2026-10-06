"""Reproducible local training and honest independent evaluation of contour decoder v2."""
import argparse
import hashlib
import json
import math
import time
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from shapes import SHAPES, CLOSED, POINTS, dataset, gallery
from model import Decoder, CONFIG, generate, export


def tensor_dataset(values):
    return tuple(torch.from_numpy(value) for value in values)


def check_dataset(values,count):
    shapes,styles,points=values
    if shapes.shape!=(count,) or styles.shape!=(count,4) or points.shape!=(count,POINTS,2):
        raise ValueError('Existing dataset cache has incompatible counts or geometry; select a new output directory.')
    if not np.array_equal(np.bincount(shapes,minlength=len(SHAPES)),np.full(len(SHAPES),count//len(SHAPES))):
        raise ValueError('Dataset must contain the exact balanced contour families.')
    if not np.isfinite(styles).all() or not np.isfinite(points).all() or np.abs(styles).max()>1 or np.abs(points).max()>1:
        raise ValueError('Dataset styles and coordinates must be finite and bounded in [-1,1].')


@torch.no_grad()
def teacher_mse(model,shapes,styles,points,batch=256):
    total=0.
    for start in range(0,len(shapes),batch):
        target=points[start:start+batch]
        previous=torch.cat([torch.zeros(len(target),1,2),target[:,:-1]],1)
        prediction=model(previous,shapes[start:start+batch],styles[start:start+batch])
        total+=F.mse_loss(prediction,target,reduction='sum').item()
    return total/points.numel()


def geometry_metrics(generated,targets,shape_ids):
    diff=np.diff(generated,axis=1)
    second=np.diff(generated,n=2,axis=1)
    mse_by_drawing=np.square(generated-targets).mean(axis=(1,2))
    result={}
    for family,name in enumerate(SHAPES):
        selected=generated[shape_ids==family]
        ref=targets[shape_ids==family]
        curve_steps=np.linalg.norm(np.diff(selected,axis=1),axis=-1)
        target_steps=np.linalg.norm(np.diff(ref,axis=1),axis=-1)
        seams=np.linalg.norm(selected[:,-1]-selected[:,0],axis=-1)
        spans=np.ptp(selected,axis=1)
        mse=np.square(selected-ref).mean()
        result[name]={'count':len(selected),'rolloutMse':float(mse),
            'rmse':float(np.sqrt(mse)),'maxDrawingMse':float(mse_by_drawing[shape_ids==family].max()),
            'finite':int(np.isfinite(selected).all(axis=(1,2)).sum()),
            'bounded':int((np.abs(selected)<=1).all(axis=(1,2)).sum()),
            'maxPointStep':float(curve_steps.max()),'targetMaxPointStep':float(target_steps.max()),
            'meanSecondDifference':float(np.linalg.norm(np.diff(selected,n=2,axis=1),axis=-1).mean()),
            'targetMeanSecondDifference':float(np.linalg.norm(np.diff(ref,n=2,axis=1),axis=-1).mean()),
            'minimumSpanX':float(spans[:,0].min()),'minimumSpanY':float(spans[:,1].min()),
            'meanClosedSeam':float(seams.mean()) if CLOSED[family] else None,
            'maxClosedSeam':float(seams.max()) if CLOSED[family] else None,
            'uniqueDrawings':len({sample.tobytes() for sample in selected}),
            'generatedStyleVariance':float(selected.var(axis=0).mean()),
            'targetStyleVariance':float(ref.var(axis=0).mean())}
    return {'rolloutMse':float(mse_by_drawing.mean()),
        'finite':int(np.isfinite(generated).all(axis=(1,2)).sum()),
        'bounded':int((np.abs(generated)<=1).all(axis=(1,2)).sum()),
        'maxPointStep':float(np.linalg.norm(diff,axis=-1).max()),
        'meanSecondDifference':float(np.linalg.norm(second,axis=-1).mean()),'families':result}


def saved_hash(model):
    return hashlib.sha256(b''.join(v.detach().numpy().tobytes() for v in model.state_dict().values())).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--steps',type=int,default=8000)
    parser.add_argument('--batch',type=int,default=64)
    parser.add_argument('--threads',type=int,default=2)
    parser.add_argument('--output',type=Path,default=Path(__file__).parent)
    parser.add_argument('--resume',type=Path)
    args=parser.parse_args()
    if not 1000<=args.steps<=100000 or not 8<=args.batch<=256 or not 1<=args.threads<=8:
        raise ValueError('Use steps1000..100000, batch8..256 andCPUthreads1..8.')
    output=args.output; output.mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(args.threads)
    torch.manual_seed(20261016);np.random.seed(20261016)
    torch.use_deterministic_algorithms(True)
    started=time.monotonic()
    path=output/'contour-dataset.npz'
    if not path.exists():
        train=dataset(64000,20261016)
        validation=dataset(3200,20261017)
        test=dataset(3200,20261018)
        np.savez_compressed(path,train_shape=train[0],train_style=train[1],train_points=train[2],
            validation_shape=validation[0],validation_style=validation[1],validation_points=validation[2],
            test_shape=test[0],test_style=test[1],test_points=test[2])
    else:
        with np.load(path) as saved:
            train=tuple(saved['train_'+field] for field in ['shape','style','points'])
            validation=tuple(saved['validation_'+field] for field in ['shape','style','points'])
            test=tuple(saved['test_'+field] for field in ['shape','style','points'])
    check_dataset(train,64000);check_dataset(validation,3200);check_dataset(test,3200)
    ts,ty,tp=tensor_dataset(train)
    vs,vy,vp=tensor_dataset(validation)
    xs,xy,xp=tensor_dataset(test)
    print(json.dumps({'datasetReadySeconds':time.monotonic()-started,'train':len(ts),'validation':len(vs),'test':len(xs),
                      'datasetBytes':path.stat().st_size,'families':SHAPES}),flush=True)
    model=Decoder()
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0015,betas=(.9,.95),weight_decay=.001)
    before=saved_hash(model)
    baseline=teacher_mse(model,vs,vy,vp)
    val_prev=torch.cat([torch.zeros(len(vp),1,2),vp[:,:-1]],1)
    persistence=F.mse_loss(val_prev,vp).item()
    step_start,best,selected_step,curves=0,float('inf'),0,[]
    if args.resume:
        checkpoint=torch.load(args.resume,weights_only=False)
        model.load_state_dict(checkpoint['model']);optimizer.load_state_dict(checkpoint['optimizer'])
        step_start,best,selected_step,curves=checkpoint['step'],checkpoint['best'],checkpoint['selectedStep'],checkpoint['curves']
        torch.set_rng_state(checkpoint['rng'])
    previous=torch.cat([torch.zeros(len(tp),1,2),tp[:,:-1]],1)
    for step in range(step_start,args.steps):
        model.train()
        indices=torch.randint(len(tp),(args.batch,))
        noise=.015+.030*min(1,step/1200)
        prev=previous[indices]+torch.randn_like(previous[indices])*noise
        prev[:,0]=0
        prediction=model(prev,ts[indices],ty[indices])
        mse=F.mse_loss(prediction,tp[indices])
        delta_target=tp[indices,1:]-tp[indices,:-1]
        delta_predicted=prediction[:,1:]-prediction[:,:-1]
        loss=mse+.18*F.mse_loss(delta_predicted,delta_target)
        optimizer.zero_grad(set_to_none=True);loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(),1)
        rate=.0015*min(1,(step+1)/120)*(.15+.85*.5*(1+math.cos(math.pi*step/args.steps)))
        for group in optimizer.param_groups: group['lr']=rate
        optimizer.step()
        if (step+1)%250==0 or step+1==args.steps:
            model.eval()
            val_teacher=teacher_mse(model,vs,vy,vp)
            # Checkpoint selection uses only validation, balanced across all16families.
            selected=generate(model,vs[:256],vy[:256])
            val_rollout=F.mse_loss(selected,vp[:256]).item()
            by_family={name:float(np.square(selected.numpy()[validation[0][:256]==i]-validation[2][:256][validation[0][:256]==i]).mean()) for i,name in enumerate(SHAPES)}
            record={'step':step+1,'trainMse':mse.item(),'validationTeacherMse':val_teacher,
                'validationRolloutMse256':val_rollout,'validationWorstFamilyMse':max(by_family.values()),
                'seconds':round(time.monotonic()-started,2)}
            curves.append(record);print(json.dumps(record),flush=True)
            # A mean/worst-family blend avoids selecting a model that neglects an intricate family.
            score=val_rollout+.35*max(by_family.values())
            if score<best:
                best,selected_step=score,step+1
                torch.save(model.state_dict(),output/'best.pt')
            torch.save({'model':model.state_dict(),'optimizer':optimizer.state_dict(),'step':step+1,
                'best':best,'selectedStep':selected_step,'curves':curves,'rng':torch.get_rng_state()},output/'last.pt')
    model.load_state_dict(torch.load(output/'best.pt',weights_only=True));model.eval()
    validation_generated=generate(model,vs,vy).numpy()
    test_generated=generate(model,xs,xy).numpy()
    val_metrics=geometry_metrics(validation_generated,validation[2],validation[0])
    test_metrics=geometry_metrics(test_generated,test[2],test[0])
    test_prev=torch.cat([torch.zeros(len(xp),1,2),xp[:,:-1]],1)
    metadata=export(model,output,selected_step)
    train_hashes={sample.tobytes() for sample in train[2]}
    train_matches=sum(sample.tobytes() in train_hashes for sample in test_generated)
    # A candidate passes only if every family is precise, smooth, noncollapsed and bounded.
    gates={'finiteBounded':test_metrics['finite']==len(xs) and test_metrics['bounded']==len(xs),
        'testMeanMse':test_metrics['rolloutMse']<.0004,
        'everyFamilyMse':all(r['rolloutMse']<.001 for r in test_metrics['families'].values()),
        'everyFamilyDiverse':all(r['uniqueDrawings']==r['count'] and r['generatedStyleVariance']>.00003 for r in test_metrics['families'].values()),
        'noTrainingReplay':train_matches==0,
        'noLargePointJump':all(r['maxPointStep']<max(.22,r['targetMaxPointStep']*1.8) for r in test_metrics['families'].values()),
        'closedSeam':all(r['maxClosedSeam'] is None or r['maxClosedSeam']<.08 for r in test_metrics['families'].values())}
    fixtures=[{'shape':SHAPES[int(validation[0][i])],'style':validation[1][i].tolist(),
        'points':validation_generated[i].tolist()} for i in range(32)]
    (output/'parity-fixtures.json').write_text(json.dumps(fixtures)+'\n')
    gallery(validation_generated[:32],output/'generated-heldout.svg')
    gallery(validation[2][:32],output/'analytic-heldout.svg')
    gallery(test_generated[:16],output/'generated-test.svg')
    report={'version':2,'trained':True,'qualityPassed':all(gates.values()),'gates':gates,
        'seed':20261016,'trainExamples':len(ts),'validationExamples':len(vs),'testExamples':len(xs),
        'trainPerFamily':len(ts)//len(SHAPES),'testPerFamily':len(xs)//len(SHAPES),
        'pointsPerDrawing':POINTS,'steps':args.steps,'selectedStep':selected_step,'batchSize':args.batch,
        'elapsedSeconds':round(time.monotonic()-started,2),'device':'cpu','threads':args.threads,
        'torchVersion':torch.__version__,'numpyVersion':np.__version__,
        'parameterCount':metadata['parameterCount'],'weightBytes':metadata['byteLength'],
        'beforeWeightsSha256':before,'afterWeightsSha256':metadata['sha256'],
        'datasetSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'datasetBytes':path.stat().st_size,
        'untrainedValidationTeacherMse':baseline,'validationPersistenceTeacherMse':persistence,
        'testTeacherMse':teacher_mse(model,xs,xy,xp),'testPersistenceTeacherMse':F.mse_loss(test_prev,xp).item(),
        'validation':val_metrics,'test':test_metrics,'exactTrainingDrawingMatches':train_matches,
        'selection':'Minimum mean rolloutMSE +0.35*worst-family rolloutMSE over256balancedvalidation styles; test never used for checkpointselection.',
        'datasetRights':'All 70,400 contour exemplars are original procedural artwork authored for this project; no external images or pretrained weights.',
        'split':'Independent style seeds20261016train,20261017validation,20261018test. Every split is exactly familybalanced.',
        'scope':'A compact learned prior over16original vector families, not general image understanding or arbitrary text-to-image.',
        'curves':curves}
    (output/'training-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['curves','validation','test']}),flush=True)
    if not report['qualityPassed']:raise SystemExit('Candidate failed geometry gates; do not integrate until corrected.')


if __name__=='__main__': main()
