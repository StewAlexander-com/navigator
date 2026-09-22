"""Offline-only street-face polygonization. Requires Shapely 2.1.2.
No runtime graph generation, inference about walkability, or OSM data fabrication.
"""
import sys,json,math
from shapely.geometry import LineString,box
from shapely.ops import unary_union,polygonize
from shapely.strtree import STRtree
source=json.load(sys.stdin);world=source['world'];chunks=source['chunks']
bounds=[min(c['bounds'][0] for c in chunks)-1,min(c['bounds'][1] for c in chunks)-1,max(c['bounds'][2] for c in chunks)+1,max(c['bounds'][3] for c in chunks)+1]
domain=box(*bounds)
classes={'primary','secondary','tertiary','residential','unclassified','living_street','pedestrian'}
lines=[domain.boundary]
for r in world['roads']:
 if r.get('highway') not in classes or r.get('bridge') not in (None,'no') or r.get('tunnel') not in (None,'no') or str(r.get('layer','0')) not in ('0','None'):continue
 line=LineString(r['points']).intersection(domain)
 if not line.is_empty:lines.append(line)
faces=sorted(polygonize(unary_union(lines)),key=lambda p:(p.centroid.x,p.centroid.y,p.area))
if not faces or abs(sum(p.area for p in faces)-domain.area)>domain.area*1e-8:raise ValueError('Street faces do not cover the source envelope')
tree=STRtree(faces);sectors=[]
for i,p in enumerate(faces):
 neighbors=sorted(int(j) for j in tree.query(p) if int(j)!=i and p.boundary.intersection(faces[int(j)].boundary).length>1e-7)
 sectors.append({'bounds':list(p.bounds),'rings':[[list(pt) for pt in p.exterior.coords]]+[[list(pt) for pt in r.coords] for r in p.interiors],'neighbors':neighbors,'chunks':[]})
for c in chunks:
 for j in tree.query(box(*c['bounds']),predicate='intersects'):sectors[int(j)]['chunks'].append(c['id'])
seen={0};pending=[0]
for i in pending:
 for j in sectors[i]['neighbors']:
  if j not in seen:seen.add(j);pending.append(j)
if len(seen)!=len(sectors):raise ValueError('Disconnected street-face graph; do not ship it')
size=128;cells={}
x0,x1=math.floor(bounds[0]/size),math.floor(bounds[2]/size);y0,y1=math.floor(bounds[1]/size),math.floor(bounds[3]/size)
if (x1-x0+1)*(y1-y0+1)>100000:raise ValueError('Locator exceeds ingest budget')
for x in range(x0,x1+1):
 for y in range(y0,y1+1):
  ids=sorted(int(j) for j in tree.query(box(x*size,y*size,(x+1)*size,(y+1)*size),predicate='intersects'))
  if ids:cells[f'{x}:{y}']=ids
json.dump({'version':1,'sourceSha256':source['sourceSha256'],'origin':world['origin'],'bounds':bounds,'method':'Ground-level street centerlines polygonized with the source-envelope boundary; adjacency is shared boundary, not route connectivity.','sectors':sectors,'chunks':chunks,'locator':{'size':size,'cells':cells}},sys.stdout,separators=(',',':'))
