import bpy
import math
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "iron-man-ar" / "public" / "models"

SRC = str(ROOT / "The_Nano_Tech_Shader_V2.blend")
OUT = str(OUT)
TMP = tempfile.mkdtemp(prefix="suitup_blender_tex_")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=SRC)

# --- 1. Extraire les textures packed du .blend, en 1024 px pour le web ---
def export_image(src_name, dst_name, size=1024):
    src = bpy.data.images.get(src_name)
    if src is None:
        raise RuntimeError("image manquante: " + src_name)
    img = src.copy()
    w, h = img.size[:]
    if max(w, h) > size:
        ratio = size / max(w, h)
        img.scale(max(1, round(w * ratio)), max(1, round(h * ratio)))
    img.file_format = "JPEG"
    img.filepath_raw = os.path.join(TMP, dst_name)
    img.save()
    print("texture", dst_name, img.size[:])
    return img.filepath_raw

p_gold = export_image("Dirty_Gold_04052024_basecolor.jpg", "gold_base.jpg")
p_metal = export_image("Dirty_Gold_04052024_metallic.jpg", "gold_metal.jpg")
p_rough = export_image("Dirty_Gold_04052024_roughness.jpg", "gold_rough.jpg")
p_norm = export_image("Dirty_Gold_04052024_normal.jpg", "gold_normal.jpg")
p_panel = export_image("Sci_Fi_Panel_20_basecolor.jpg", "panel_base.jpg")

# Copie de la texture "panneau sci-fi" pour le shader nano-tech côté navigateur
shutil.copyfile(p_panel, os.path.join(OUT, "nano_panel.jpg"))

def tex_node(nodes, path, colorspace="sRGB"):
    n = nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path, check_existing=True)
    n.image.colorspace_settings.name = colorspace
    return n

def make_pbr(name, base, metal, rough, normal, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.9
    bsdf.inputs["Roughness"].default_value = 0.32
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    t_base = tex_node(nt.nodes, base)
    nt.links.new(t_base.outputs["Color"], bsdf.inputs["Base Color"])
    t_metal = tex_node(nt.nodes, metal, "Non-Color")
    nt.links.new(t_metal.outputs["Color"], bsdf.inputs["Metallic"])
    t_rough = tex_node(nt.nodes, rough, "Non-Color")
    nt.links.new(t_rough.outputs["Color"], bsdf.inputs["Roughness"])
    t_norm = tex_node(nt.nodes, normal, "Non-Color")
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.65
    nt.links.new(t_norm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 1.4
    return mat

gold_mat = make_pbr("Mark86 Nano Gold", p_gold, p_metal, p_rough, p_norm)

# --- 2. Isoler et recentrer le mesh Suzanne du .blend ---
head = bpy.data.objects["Suzanne"]
head.name = "NanoTechHead"
head.data = head.data.copy()
head.data.materials.clear()
head.data.materials.append(gold_mat)
head.location = (0.0, 0.0, 0.0)
head.rotation_euler = (0.0, 0.0, 0.0)
head.scale = (1.0, 1.0, 1.0)

# recentrer la géométrie sur son centre et normaliser à ~2 unités
bpy.context.view_layer.objects.active = head
bpy.ops.object.select_all(action="DESELECT")
head.select_set(True)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
head.location = (0.0, 0.0, 0.0)
mx = max(head.dimensions)
if mx > 0:
    s = 2.0 / mx
    head.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# Version allégée pour le web (le hologramme reste fidèle à ~12k sommets)
dec = head.modifiers.new("WebDecimate", "DECIMATE")
dec.ratio = 0.4
bpy.ops.object.modifier_apply(modifier=dec.name)
print("head dims", tuple(round(v, 3) for v in head.dimensions), "verts", len(head.data.vertices))

def export_glb(objects, filepath):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_image_quality=82,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    print("exported", filepath, os.path.getsize(filepath))

export_glb([head], os.path.join(OUT, "nanotech_head.glb"))

# --- 3. Réacteur ARC : modèle créé dans Blender pour la scène AR ---
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)

def simple_mat(name, color, metal=0.85, rough=0.25, emission=(0, 0, 0, 1), strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = color
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Emission Color"].default_value = emission
    b.inputs["Emission Strength"].default_value = strength
    return m

gold = simple_mat("Reactor Gold", (0.72, 0.46, 0.12, 1), 0.95, 0.22)
dark = simple_mat("Reactor Dark", (0.06, 0.08, 0.11, 1), 0.85, 0.3)
glow = simple_mat("Reactor Core", (0.55, 0.95, 1.0, 1), 0.1, 0.2, (0.35, 0.9, 1.0, 1), 3.0)

def torus(name, major, minor, mat, z=0.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                    major_segments=64, minor_segments=12, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o

def disc(name, radius, depth, mat, z=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    o.rotation_euler[0] = math.pi / 2   # face +Z (caméra)
    o.data.materials.append(mat)
    return o

objs = []
objs.append(torus("OuterRing", 1.0, 0.075, gold, 0.0))
objs.append(torus("InnerRing", 0.74, 0.045, dark, 0.02))
objs.append(disc("Core", 0.52, 0.10, glow, 0.05))
objs.append(torus("CoreRing", 0.53, 0.055, gold, 0.10))
for i in range(12):
    a = i * math.tau / 12
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * 0.88, math.sin(a) * 0.88, 0.04))
    o = bpy.context.object
    o.name = f"Segment{i:02d}"
    o.dimensions = (0.16, 0.26, 0.09)
    o.rotation_euler[2] = a - math.pi / 2
    o.data.materials.append(dark)
    objs.append(o)

export_glb(objs, os.path.join(OUT, "arc_reactor.glb"))
print("DONE")

# Nettoyage des textures temporaires
shutil.rmtree(TMP, ignore_errors=True)
