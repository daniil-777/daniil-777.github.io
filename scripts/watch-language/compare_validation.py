"""Validation-only comparison across tokenizations; no test-based candidate selection."""
import sys,json,math,argparse
from pathlib import Path
import torch
sys.path.insert(0,str(Path(__file__).resolve().parent))
from model import load_checkpoint
from tokenizer import Tokenizer
from train import loss
from evaluate import greedy

p=argparse.ArgumentParser()
p.add_argument('--dataset',type=Path,required=True)
p.add_argument('--candidate',nargs=3,action='append',required=True,metavar=('LABEL','CHECKPOINT','TOKENIZER'))
p.add_argument('--output',type=Path,required=True)
p.add_argument('--suite-size',type=int,default=32)
a=p.parse_args()
torch.set_num_threads(2)
rows=[json.loads(x) for x in a.dataset.read_text().splitlines() if json.loads(x)['split']=='validation']
# Frozen hash ordering takes whole unique validation facts, independent of test.
import hashlib
unique={r['factGroup']:r for r in rows if r['task']=='question'}
suite=sorted(unique.values(), key=lambda r:hashlib.sha256(r['factGroup'].encode()).hexdigest())[:a.suite_size]
results=[]
for name,checkpoint_path,tokenizer_path in a.candidate:
 model, checkpoint=load_checkpoint(Path(checkpoint_path)); tokenizer=Tokenizer.load(Path(tokenizer_path))
 total_nll=total_bytes=total_tokens=0
 raw=[]
 with torch.no_grad():
  for row in rows:
   answer=tokenizer.encode(row['answer'])+[2]
   prompt,included=tokenizer.prompt(row,max_new=len(answer))
   assert row['abstain'] or set(row['supportedFactIds'])<=set(included)
   assert len(prompt)+len(answer)<=256
   total_nll+=float(loss(model,(prompt+answer,len(prompt)),'cpu'))*len(answer)
   total_bytes+=len(row['answer'].encode())
   total_tokens+=len(answer)
  for row in suite:
   text,timing=greedy(model,tokenizer,row)
   raw.append({'id':row['id'],'sourceGroup':row['sourceGroup'],'domain':row['domain'],'expected':row['answer'],'text':text,'exactMatch':text.strip()==row['answer'].strip(),'completeWithin20':bool(text.strip())and len(text.split())<=20 and text.strip()[-1:]in'.!?',**timing})
 result={'candidate':name,'checkpointStep':checkpoint['step'],'validationRows':len(rows),'answerBytes':total_bytes,'answerTokensIncludingEOS':total_tokens,'answerNllNatsIncludingEOS':total_nll,'bitsPerUtf8AnswerByteIncludingEosNll':total_nll/math.log(2)/total_bytes,'frozenValidationGenerations':len(raw),'exactMatches':sum(r['exactMatch']for r in raw),'completeWithin20':sum(r['completeWithin20']for r in raw),'generations':raw}
 results.append(result);print(json.dumps({k:v for k,v in result.items()if k!='generations'}),flush=True)
report={'method':'Each candidate checkpoint chosen by minimum validation token cross-entropy within its own tokenizer; candidates compared on identical validation targets by answer+EOS negative log likelihood per UTF-8 answer byte and a fixed hash-selected unique-fact greedy-generation suite. Test generations are not consulted.', 'datasetSha256':hashlib.sha256(a.dataset.read_bytes()).hexdigest(),'results':results,'selectionRule':'Prioritize canonical exact match on the fixed validation generation suite, then lower normalized bits per byte when exact counts tie.','selected':min(results,key=lambda r:(-r['exactMatches'],r['bitsPerUtf8AnswerByteIncludingEosNll']))['candidate']}
a.output.write_text(json.dumps(report,indent=2)+'\n')
print('selected',report['selected'])
