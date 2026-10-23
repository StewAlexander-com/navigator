# Builds the wayfinding assets (street signpost, sign blade, place beacon) and exports public/models/wayfinding.glb.
#   ~/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/wayfinding.py -- [preview.png]
# Units are metres, Z up. Vertex colour R tags parts for the shaders: beacon body 1.0, halo 0.5, ground ring 0.0;
# signpost metal 1.0, cap 0.5. Blade UVs are assigned in the app (the blade is reused for every street name).
import bpy, bmesh, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models', 'wayfinding.glb')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

bpy.ops.wm.read_factory_settings(use_empty=True)

def tag(obj, value):
    mesh = obj.data
    attr = mesh.color_attributes.new(name='Col', type='BYTE_COLOR', domain='CORNER')
    for loop in attr.data:
        loop.color = (value, value, value, 1.0)

def finish(obj, smooth_angle=None):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if smooth_angle is None:
        bpy.ops.object.shade_flat()
    else:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    obj.select_set(False)
    return obj

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    # Triangulate so the exported buffer is exactly what three.js draws.
    bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(obj.data); bm.free()
    return obj

def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

# Signpost: a 2.7 m pole whose top collar carries the stacked blades (lower blade centred at 2.92 m, upper at 3.38 m),
# a spacer collar in the 4 cm gap between them and a ball finial on the upper blade, so no metal crosses the names.
parts = []
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.055, depth=2.66, location=(0, 0, 1.33)); parts.append(finish(bpy.context.object, 40))
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.13, depth=.22, location=(0, 0, .11)); base = bpy.context.object
bev = base.modifiers.new('bevel', 'BEVEL'); bev.width = .03; bev.segments = 2; apply_mods(base); parts.append(finish(base, 40))
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.085, depth=.05, location=(0, 0, .24)); parts.append(finish(bpy.context.object, 40))
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.08, depth=.07, location=(0, 0, 2.675)); parts.append(finish(bpy.context.object, 40))
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.06, depth=.045, location=(0, 0, 3.15)); parts.append(finish(bpy.context.object, 40))
for p in parts: tag(p, 1.0)
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.03, depth=.06, location=(0, 0, 3.62)); stem = finish(bpy.context.object, 40); tag(stem, 1.0); parts.append(stem)
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=.075, location=(0, 0, 3.70)); cap = finish(bpy.context.object, 50); tag(cap, .5)
join(parts + [cap], 'Signpost')

# Blade: 2.4 × 0.42 m, 3.5 cm thick, bevelled edges, centred on the pole axis and running along +X.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0)); blade = bpy.context.object
blade.scale = (2.4, .035, .42); bpy.ops.object.transform_apply(scale=True)
bev = blade.modifiers.new('bevel', 'BEVEL'); bev.width = .012; bev.segments = 2; apply_mods(blade)
finish(blade); tag(blade, 1.0); join([blade], 'Blade')

# Beacon: a faceted map pin (icosphere head on an 8-sided cone, tip at the origin), an equatorial halo ring and a
# ground ring. The app lifts the pin and halo above the ground and scales them with distance; the ring stays on the ground.
bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0, radius2=.3, depth=.56, location=(0, 0, .28)); cone = finish(bpy.context.object)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.34, location=(0, 0, .66)); head = finish(bpy.context.object)
tag(cone, 1.0); tag(head, 1.0)
bpy.ops.mesh.primitive_torus_add(major_radius=.5, minor_radius=.03, major_segments=24, minor_segments=4, location=(0, 0, .66)); halo = finish(bpy.context.object); tag(halo, .5)
bpy.ops.mesh.primitive_torus_add(major_radius=.9, minor_radius=.06, major_segments=28, minor_segments=4, location=(0, 0, 0)); ring = bpy.context.object
ring.scale = (1, 1, .25); ring = finish(ring); tag(ring, 0.0)
join([cone, head, halo, ring], 'Beacon')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True, export_normals=True,
                          export_texcoords=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                          export_materials='NONE', export_yup=True)
print('exported', OUT, os.path.getsize(OUT), 'bytes')

# Optional preview render of the asset set (not used by the app).
if args:
    scene = bpy.context.scene
    sign, bl, beacon = (bpy.data.objects[n] for n in ('Signpost', 'Blade', 'Beacon'))
    def mat(name, rgb, emit=0.0):
        m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = .45
        if emit: b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = emit
        return m
    sign.data.materials.append(mat('metal', (.12, .2, .24)))
    for z, rot in ((3.38, 0), (2.92, math.pi / 2)):
        c = bl.copy(); c.data = bl.data.copy(); c.location = (0, 0, z); c.rotation_euler = (0, 0, rot); scene.collection.objects.link(c)
        c.data.materials.append(mat('blade', (.06, .18, .22)))
    bpy.data.objects.remove(bl)
    colours = [(.95, .62, .2), (.95, .4, .62), (.35, .62, .98), (.68, .5, .98), (.3, .92, .9)]
    for i, rgb in enumerate(colours):
        b = beacon.copy(); b.data = beacon.data.copy(); b.location = (1.8 + i * 1.5, 1.5 - i * .2, 0); b.scale = (1.1, 1.1, 1.1)
        scene.collection.objects.link(b); b.data.materials.append(mat('pin%d' % i, rgb, .25))
    bpy.data.objects.remove(beacon)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0)); bpy.context.object.data.materials.append(mat('ground', (.62, .55, .44)))
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(-30))); bpy.context.object.data.energy = 3.5
    world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .68, .78, 1); world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
    bpy.ops.object.camera_add(location=(-4.2, -7.5, 2.6)); cam = bpy.context.object; scene.camera = cam
    target = bpy.data.objects.new('target', None); target.location = (2.4, .3, 1.6); scene.collection.objects.link(target)
    t = cam.constraints.new('TRACK_TO'); t.target = target; t.track_axis = 'TRACK_NEGATIVE_Z'; t.up_axis = 'UP_Y'
    cam.data.lens = 32
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    scene.render.filepath = os.path.abspath(args[0]); bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)
