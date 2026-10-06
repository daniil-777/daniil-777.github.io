"""Original calming nature contours; procedural exemplars never ship to the browser."""
import math
import numpy as np

SHAPES = ['leaf', 'wave', 'mountain', 'flower', 'lotus', 'shell', 'butterfly', 'moon',
          'cloud', 'koi', 'swan', 'fern', 'ginkgo', 'feather', 'acorn', 'pebble']
CLOSED = [True, False, False, True, True, False, True, True,
          True, True, True, True, True, True, True, True]
POINTS = 96


def resample(path, count=POINTS):
    distances = np.concatenate([[0.], np.linalg.norm(np.diff(path, axis=0), axis=1).cumsum()])
    targets = np.linspace(0, distances[-1], count)
    return np.stack([np.interp(targets, distances, path[:, axis]) for axis in range(2)], -1)


def smooth_outline(keys, tension=.72):
    """Original hand-authored landmarks with gentle Hermite interpolation."""
    points = np.asarray(keys, dtype=np.float64)
    closed = np.linalg.norm(points[0] - points[-1]) < 1e-9
    count = len(points) - 1 if closed else len(points)
    def point(i):
        return points[i % count] if closed else points[min(count-1,max(0,i))]
    output = []
    for i in range(len(points)-1):
        a,b,c,d = point(i-1),point(i),point(i+1),point(i+2)
        m1,m2 = (c-a)*tension/2, (d-b)*tension/2
        t = np.linspace(0,1,18,endpoint=False)[:,None]
        output.append((2*t**3-3*t**2+1)*b+(t**3-2*t**2+t)*m1+(-2*t**3+3*t**2)*c+(t**3-t**2)*m2)
    output.append(points[-1:])
    return resample(np.concatenate(output))


def original_four(shape, style):
    a,b,c,d = style
    t = np.linspace(0,1,POINTS)
    angle = t*2*np.pi
    if shape == 'leaf':
        x=(.43+.07*b)*np.sin(angle)*np.abs(np.sin(angle))*(.9+.1*np.cos(angle))
        y=-(.76+.05*c)*np.cos(angle)
        x+=.09*d*(1-y*y)
        rotation=a*.24
        x,y=x*np.cos(rotation)-y*np.sin(rotation),x*np.sin(rotation)+y*np.cos(rotation)
    elif shape == 'wave':
        x=-.87+1.74*t
        y=(.16+.035*b)*np.sin(2*np.pi*(1.25+.2*a)*t+.35*c)
        y+=.035*np.sin(4*np.pi*t+d)+.075*d*x
    elif shape == 'mountain':
        x=-.85+1.7*t
        y=.30-(.36+.05*a)*np.exp(-((x+.46+.05*c)/.22)**2)
        y-=(.62+.06*b)*np.exp(-((x-.10+.03*d)/.27)**2)
        y-=(.28+.03*c)*np.exp(-((x-.60)/.21)**2)
    else:
        radius=.53+(.12+.025*b)*np.cos(5*angle+a*.35)
        x=radius*np.sin(angle)*(.92+.07*c)
        y=-radius*np.cos(angle)*(1.02+.04*d)
    return np.stack([x,y],-1)


def base_outline(shape, feature):
    t=np.linspace(0,1,POINTS)
    angle=t*2*np.pi
    if shape == 'lotus':
        return smooth_outline([(0,.55),(-.48,.36),(-.79,-.03),(-.46,.08),(-.58,-.36),
            (-.25,-.12),(-.30,-.59),(-.06,-.29),(0,-.81),(.31,-.47),(.23,-.13),
            (.59,-.36),(.46,.08),(.79,-.03),(.48,.36),(0,.55)],tension=.48)
    if shape == 'shell':
        theta=np.linspace(-.55*np.pi,4.85*np.pi,POINTS)
        radius=.76*np.exp(-.15*(theta-theta[0]))
        radius*=1+(.025+.012*feature)*np.sin(9*theta)*np.exp(-.1*(theta-theta[0]))
        return np.stack([radius*np.cos(theta),radius*np.sin(theta)],-1)
    if shape == 'butterfly':
        return smooth_outline([(0,-.28),(-.32,-.67),(-.69,-.74),(-.80,-.40),(-.62,-.01),
            (-.27,.07),(-.54,.36),(-.42,.65),(-.19,.49),(0,.20),(.19,.49),(.42,.65),
            (.54,.36),(.27,.07),(.62,-.01),(.80,-.40),(.69,-.74),(.32,-.67),(0,-.28)])
    if shape == 'moon':
        # Join two arcs at their shared pointed tips to make a crescent.
        theta=np.linspace(-.40*np.pi,.40*np.pi,180)
        outer=np.stack([-.72*np.cos(theta),.72*np.sin(theta)],-1)
        y=np.linspace(outer[-1,1],outer[0,1],180)
        x=-.12-.09*feature-(.32+.04*feature)*(1-(y/outer[-1,1])**2)
        x[0]=x[-1]=outer[0,0]
        return resample(np.concatenate([outer,np.stack([x,y],-1),outer[:1]]))
    if shape == 'cloud':
        return smooth_outline([(-.68,.22),(-.83,.07),(-.77,-.14),(-.57,-.23),(-.46,-.20),
            (-.40,-.46),(-.15,-.63),(.12,-.56),(.29,-.32),(.51,-.37),(.70,-.22),
            (.72,-.06),(.85,.08),(.75,.26),(.49,.32),(-.45,.32),(-.68,.22)])
    if shape == 'koi':
        return smooth_outline([(-.83,-.26),(-.45,-.12),(-.26,-.31),(-.09,-.52),(.10,-.37),
            (.43,-.28),(.71,-.12),(.83,.03),(.65,.23),(.29,.35),(.09,.44),(-.16,.29),
            (-.45,.13),(-.82,.35),(-.67,.03),(-.83,-.26)],tension=.56)
    if shape == 'swan':
        return smooth_outline([(-.83,.12),(-.58,.00),(-.23,.09),(.05,.20),(.28,.11),
            (.33,-.12),(.15,-.34),(.14,-.57),(.31,-.75),(.52,-.75),(.65,-.62),
            (.77,-.51),(.60,-.48),(.44,-.51),(.39,-.33),(.53,-.08),(.61,.19),
            (.41,.44),(.08,.54),(-.31,.45),(-.62,.30),(-.83,.12)],tension=.61)
    if shape == 'fern':
        # A tapered frond silhouette with many paired leaflets and a small stem.
        y=np.linspace(.76,-.80,400)
        u=(.76-y)/1.56
        width=.33*np.sin(np.pi*u)**.8
        serration=.50+.50*np.sin(np.pi*13*u)**2
        x=width*serration
        left=np.stack([-x+.035*np.sin(np.pi*u),y],-1)
        right=np.stack([x+.035*np.sin(np.pi*u),y],-1)[::-1]
        return resample(np.concatenate([left,right,left[:1]]))
    if shape == 'ginkgo':
        theta=np.linspace(-.96*np.pi,-.04*np.pi,450)
        radius=.73*(1+(.018+.01*feature)*np.sin(15*theta))
        arch=np.stack([radius*np.cos(theta),radius*np.sin(theta)],-1)
        arch[:,1]+=.22
        # Separate outer fan arcs by a shallow central notch without crossing them.
        fan=arch.copy(); middle=len(fan)//2
        fan[middle-13:middle+14,1]+=.11*np.hanning(27)
        outline=np.concatenate([[[.035,.78],[.035,.27]],fan[::-1],[[-.035,.27],[-.035,.78],[.035,.78]]])
        return resample(outline)
    if shape == 'feather':
        y=-.79*np.cos(angle)
        taper=np.sin(angle)*np.abs(np.sin(angle))**.25
        width=.30+.018*np.sin(8*angle)**2
        x=width*taper+.07*np.sin(angle/2)**2
        return np.stack([x,y],-1)
    if shape == 'acorn':
        return smooth_outline([(0,.78),(-.37,.38),(-.44,-.10),(-.58,-.16),(-.46,-.43),
            (-.10,-.55),(-.06,-.79),(.07,-.79),(.09,-.55),(.43,-.42),(.57,-.16),
            (.43,-.10),(.36,.38),(0,.78)],tension=.62)
    if shape == 'pebble':
        radius=.63+.035*np.cos(3*angle+.25*feature)+.025*np.sin(2*angle)
        x=radius*np.cos(angle)*1.08
        y=radius*np.sin(angle)*.76
        return np.stack([x,y],-1)
    raise ValueError(shape)


def contour(shape, style):
    name=SHAPES[int(shape)] if isinstance(shape,(int,np.integer)) else shape
    a,b,c,d=map(float,style)
    if name in SHAPES[:4]:
        output=original_four(name,(a,b,c,d))
    else:
        output=base_outline(name,c).copy()
        output[:,0]*=1+.07*b
        output[:,1]*=1+.05*c
        output[:,0]+=.03*d*(1-output[:,1]**2)
        rotation=.11*a
        x,y=output[:,0].copy(),output[:,1].copy()
        output[:,0]=x*math.cos(rotation)-y*math.sin(rotation)
        output[:,1]=x*math.sin(rotation)+y*math.cos(rotation)
    if CLOSED[SHAPES.index(name)]:
        output[-1]=output[0]
    return output.astype(np.float32)


def dataset(count, seed):
    if count % len(SHAPES):
        raise ValueError('Dataset count must balance every contour family exactly.')
    rng=np.random.default_rng(seed)
    shapes=np.arange(count,dtype=np.int64)%len(SHAPES)
    styles=rng.uniform(-1,1,(count,4)).astype(np.float32)
    points=np.stack([contour(shape,style) for shape,style in zip(shapes,styles)])
    return shapes,styles,points


def gallery(samples, filename, labels=None):
    rows=math.ceil(len(samples)/4)
    output=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="{rows*260}" viewBox="0 0 1120 {rows*260}">',
        f'<rect width="1120" height="{rows*260}" fill="#f2e8d2"/>']
    for i,points in enumerate(samples):
        x,y=(i%4)*280,(i//4)*260
        path='M'+' L'.join(f'{x+140+px*112:.2f},{y+125+py*112:.2f}' for px,py in points)
        output.append(f'<path d="{path}" stroke="#584631" stroke-width="1.65" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
        output.append(f'<text x="{x+18}" y="{y+246}" fill="#766349" font-family="Georgia" font-size="16">{labels[i] if labels else SHAPES[i%len(SHAPES)]}</text>')
    output.append('</svg>')
    filename.write_text('\n'.join(output))
