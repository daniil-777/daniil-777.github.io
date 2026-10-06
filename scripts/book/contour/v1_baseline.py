"""Read the actual released v1 float32 checkpoint for original-family regression checks."""
import hashlib
import json
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F


class RMSNorm(nn.Module):
    def __init__(self,width):
        super().__init__();self.weight=nn.Parameter(torch.ones(width))
    def forward(self,x):
        return x*torch.rsqrt(x.square().mean(-1,keepdim=True)+1e-6)*self.weight


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.attention_norm=RMSNorm(32);self.qkv=nn.Linear(32,96,bias=False)
        self.attention_out=nn.Linear(32,32,bias=False);self.feedforward_norm=RMSNorm(32)
        self.gate=nn.Linear(32,64,bias=False);self.up=nn.Linear(32,64,bias=False);self.down=nn.Linear(64,32,bias=False)
    def forward(self,x):
        batch,length,width=x.shape
        q,k,v=self.qkv(self.attention_norm(x)).reshape(batch,length,3,4,8).permute(2,0,3,1,4)
        attended=F.scaled_dot_product_attention(q,k,v,is_causal=True)
        x=x+self.attention_out(attended.transpose(1,2).reshape(batch,length,width))
        norm=self.feedforward_norm(x)
        return x+self.down(F.silu(self.gate(norm))*self.up(norm))


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.input=nn.Linear(10,32);self.position=nn.Embedding(48,32)
        self.blocks=nn.ModuleList([Block(),Block()]);self.norm=RMSNorm(32);self.output=nn.Linear(32,2)
    def forward(self,previous,shape,style):
        condition=torch.cat([F.one_hot(shape,4).float(),style],-1)
        x=self.input(torch.cat([previous,condition[:,None].expand(-1,previous.shape[1],-1)],-1))+self.position.weight[:previous.shape[1]]
        for block in self.blocks:x=block(x)
        return torch.tanh(self.output(self.norm(x)))


def load(folder):
    metadata=json.loads((folder/'contour-decoder.json').read_text())
    binary=(folder/'contour-decoder.bin').read_bytes()
    if metadata['version']!=1 or hashlib.sha256(binary).hexdigest()!=metadata['sha256']:
        raise ValueError('A checksum-matching exported v1 baseline is required.')
    model=Decoder();flat=np.frombuffer(binary,dtype='<f4')
    state={}
    for name,tensor in model.state_dict().items():
        descriptor=metadata['weights'][name]
        if descriptor['shape']!=list(tensor.shape):raise ValueError('Incompatible v1 baseline tensor')
        state[name]=torch.from_numpy(flat[descriptor['offset']:descriptor['offset']+descriptor['length']].copy().reshape(descriptor['shape']))
    model.load_state_dict(state);model.eval()
    return model


@torch.no_grad()
def generate(model,shapes,styles):
    previous=torch.zeros(len(shapes),1,2);output=[]
    for _ in range(48):
        predicted=model(previous,shapes,styles)[:,-1]
        output.append(predicted);previous=torch.cat([previous,predicted[:,None]],1)
    return torch.stack(output,1)
