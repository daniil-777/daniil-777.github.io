"""Candidate A: exact 2,361,024 parameters, true grouped KV and one cached graph."""
import math
from dataclasses import dataclass, asdict
import torch
from torch import nn
import torch.nn.functional as F


@dataclass
class Config:
    layers: int = 4
    width: int = 192
    ffn: int = 512
    heads: int = 6
    kvHeads: int = 2
    headDim: int = 32
    vocab: int = 4096
    context: int = 256


class RMSNorm(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(width))

    def forward(self, x):
        return x * torch.rsqrt(x.square().mean(-1, keepdim=True) + 1e-6) * self.weight


def rope(x, positions):
    inverse = 1.0 / (10000 ** (torch.arange(0, 32, 2, device=x.device).float() / 32))
    angle = positions.float()[:, None, :, None] * inverse
    cosine, sine = angle.cos(), angle.sin()
    even, odd = x[..., 0::2], x[..., 1::2]
    return torch.stack((even * cosine - odd * sine, even * sine + odd * cosine), -1).flatten(-2)


class Layer(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.c = c
        self.attn_norm, self.ffn_norm = RMSNorm(c.width), RMSNorm(c.width)
        self.q = nn.Linear(c.width, c.heads * c.headDim, bias=False)
        self.k = nn.Linear(c.width, c.kvHeads * c.headDim, bias=False)
        self.v = nn.Linear(c.width, c.kvHeads * c.headDim, bias=False)
        self.out = nn.Linear(c.width, c.width, bias=False)
        self.gate = nn.Linear(c.width, c.ffn, bias=False)
        self.up = nn.Linear(c.width, c.ffn, bias=False)
        self.down = nn.Linear(c.ffn, c.width, bias=False)

    def forward(self, x, positions, mask, past):
        c, length = self.c, x.shape[1]
        h = self.attn_norm(x)
        q = rope(self.q(h).reshape(1, length, c.heads, c.headDim).transpose(1, 2), positions)
        k = rope(self.k(h).reshape(1, length, c.kvHeads, c.headDim).transpose(1, 2), positions)
        v = self.v(h).reshape(1, length, c.kvHeads, c.headDim).transpose(1, 2)
        k, v = torch.cat((past[0], k), 2), torch.cat((past[1], v), 2)
        present = torch.stack((k, v))
        # Persistent caches stay grouped; only attention's ephemeral view expands KV heads.
        key = k[:, :, None].expand(1, c.kvHeads, c.heads // c.kvHeads, k.shape[2], c.headDim).reshape(1, c.heads, k.shape[2], c.headDim)
        val = v[:, :, None].expand(1, c.kvHeads, c.heads // c.kvHeads, v.shape[2], c.headDim).reshape(1, c.heads, v.shape[2], c.headDim)
        scores = q @ key.transpose(-1, -2) / math.sqrt(c.headDim)
        allowed = torch.arange(k.shape[2], device=x.device)[None, None, None, :] <= positions[:, None, :, None]
        allowed = allowed & (mask[:, None, None, :] > 0)
        attention = torch.softmax(scores.masked_fill(~allowed, -1e4), -1)
        h = (attention @ val).transpose(1, 2).reshape(1, length, c.width)
        x = x + self.out(h)
        h = self.ffn_norm(x)
        return x + self.down(F.silu(self.gate(h)) * self.up(h)), present


class TinyDecoder(nn.Module):
    def __init__(self, config=None):
        super().__init__()
        self.config = config or Config()
        c = self.config
        self.embedding = nn.Embedding(c.vocab, c.width)
        self.layers = nn.ModuleList(Layer(c) for _ in range(c.layers))
        self.norm = RMSNorm(c.width)
        self.apply(self._init)

    def _init(self, module):
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, std=.02)

    def empty_cache(self, device='cpu'):
        c = self.config
        return torch.empty(c.layers, 2, 1, c.kvHeads, 0, c.headDim, device=device)

    def forward(self, input_ids, position_ids, attention_mask, past):
        x = self.embedding(input_ids)
        cache = []
        for i, layer in enumerate(self.layers):
            x, present = layer(x, position_ids, attention_mask, past[i])
            cache.append(present)
        return F.linear(self.norm(x), self.embedding.weight), torch.stack(cache)

    def complete(self, ids):
        device = self.embedding.weight.device
        token = torch.tensor([ids], dtype=torch.long, device=device)
        positions = torch.arange(len(ids), device=device)[None]
        return self(token, positions, torch.ones_like(token, dtype=torch.float), self.empty_cache(device))[0]


def load_checkpoint(path, device='cpu'):
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    model = TinyDecoder(Config(**checkpoint['architecture'])).to(device)
    model.load_state_dict(checkpoint['model'])
    model.eval()
    return model, checkpoint
