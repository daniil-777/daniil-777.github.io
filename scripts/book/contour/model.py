"""Width-48 decoder with real causal attention and incremental KV-cache inference."""
import hashlib
import json
import torch
from torch import nn
import torch.nn.functional as F
from shapes import SHAPES, CLOSED, POINTS

CONFIG={'width':48,'layers':2,'heads':4,'ffn':96,'points':POINTS,'input':len(SHAPES)+6,'epsilon':1e-6}


class RMSNorm(nn.Module):
    def __init__(self,width):
        super().__init__()
        self.weight=nn.Parameter(torch.ones(width))
    def forward(self,x):
        return x*torch.rsqrt(x.square().mean(-1,keepdim=True)+CONFIG['epsilon'])*self.weight


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        w,f=CONFIG['width'],CONFIG['ffn']
        self.attention_norm=RMSNorm(w)
        self.qkv=nn.Linear(w,w*3,bias=False)
        self.attention_out=nn.Linear(w,w,bias=False)
        self.feedforward_norm=RMSNorm(w)
        self.gate=nn.Linear(w,f,bias=False)
        self.up=nn.Linear(w,f,bias=False)
        self.down=nn.Linear(f,w,bias=False)
    def projected(self,x):
        b,t,w=x.shape
        return self.qkv(self.attention_norm(x)).reshape(b,t,3,CONFIG['heads'],w//CONFIG['heads']).permute(2,0,3,1,4)
    def finish(self,x,attended):
        b,t,w=x.shape
        x=x+self.attention_out(attended.transpose(1,2).reshape(b,t,w))
        norm=self.feedforward_norm(x)
        return x+self.down(F.silu(self.gate(norm))*self.up(norm))
    def forward(self,x):
        q,k,v=self.projected(x)
        return self.finish(x,F.scaled_dot_product_attention(q,k,v,is_causal=True))
    def step(self,x,cache,position):
        q,k,v=self.projected(x)
        cache[0][:,:,position:position+1]=k
        cache[1][:,:,position:position+1]=v
        return self.finish(x,F.scaled_dot_product_attention(q,cache[0][:,:,:position+1],cache[1][:,:,:position+1],is_causal=False))


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.input=nn.Linear(CONFIG['input'],CONFIG['width'])
        self.position=nn.Embedding(POINTS,CONFIG['width'])
        self.blocks=nn.ModuleList([Block() for _ in range(CONFIG['layers'])])
        self.norm=RMSNorm(CONFIG['width'])
        self.output=nn.Linear(CONFIG['width'],2)
        nn.init.normal_(self.position.weight,std=.02)
    def condition(self,previous,shape,style):
        condition=torch.cat([F.one_hot(shape,len(SHAPES)).float(),style],-1)
        return torch.cat([previous,condition[:,None].expand(-1,previous.shape[1],-1)],-1)
    def forward(self,previous,shape,style):
        x=self.input(self.condition(previous,shape,style))+self.position.weight[:previous.shape[1]]
        for block in self.blocks:
            x=block(x)
        return torch.tanh(self.output(self.norm(x)))
    def step(self,previous,shape,style,position,caches):
        x=self.input(self.condition(previous[:,None],shape,style))+self.position.weight[position]
        for block,cache in zip(self.blocks,caches):
            x=block.step(x,cache,position)
        return torch.tanh(self.output(self.norm(x)))[:,0]


@torch.no_grad()
def generate(model,shapes,styles,batch=256):
    all_points=[]
    for start in range(0,len(shapes),batch):
        shape,style=shapes[start:start+batch],styles[start:start+batch]
        previous=torch.zeros(len(shape),2)
        caches=[(torch.zeros(len(shape),CONFIG['heads'],POINTS,CONFIG['width']//CONFIG['heads']),
                 torch.zeros(len(shape),CONFIG['heads'],POINTS,CONFIG['width']//CONFIG['heads'])) for _ in model.blocks]
        points=[]
        for position in range(POINTS):
            previous=model.step(previous,shape,style,position,caches)
            points.append(previous)
        all_points.append(torch.stack(points,1))
    return torch.cat(all_points)


def export(model,folder,selected_step):
    offset,descriptors,data=0,{},[]
    for name,value in model.state_dict().items():
        array=value.detach().cpu().numpy().astype('<f4')
        descriptors[name]={'offset':offset,'shape':list(array.shape),'length':int(array.size)}
        data.append(array.tobytes()); offset+=array.size
    binary=b''.join(data)
    (folder/'contour-decoder.bin').write_bytes(binary)
    metadata={'version':2,'architecture':CONFIG,'shapes':SHAPES,'closed':CLOSED,'dtype':'float32-le',
        'parameterCount':offset,'byteLength':len(binary),'sha256':hashlib.sha256(binary).hexdigest(),
        'weights':descriptors,'seed':20261016,'trained':True,'selectedStep':selected_step,
        'representation':f'{POINTS} autoregressive xy vector tokens, each within [-1,1]',
        'conditioning':'One-hot contour family plus four independently seeded style values in [-1,1].'}
    (folder/'contour-decoder.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return metadata
