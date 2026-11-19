"""Rendu Cycles du shader Nano Tech FX V2 du .blend, pour la vitrine du site.

Utilisation (Blender 4.x ou module bpy) :
    blender -b --python tools/render_model_poster.py
    # ou : python tools/render_model_poster.py  (avec le module bpy installé)
"""

import bpy
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = str(ROOT / "The_Nano_Tech_Shader_V2.blend")
DEST = ROOT / "iron-man-ar" / "public" / "posters" / "nanotech_model_front.png"

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
# Frame 56 : le shader nano-tech est partiellement matérialisé.
scene.frame_set(56)
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 640
scene.render.resolution_y = 520
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
DEST.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(DEST)

# Le .blend ne contient ni caméra ni lumière : on les ajoute pour la vitrine.
bpy.ops.object.camera_add(location=(0.0, 5.4, 1.25))
cam = bpy.context.object
cam.rotation_euler = (Vector((0.0, 0.0, 1.05)) - cam.location).to_track_quat(
    "-Z", "Y"
).to_euler()
cam.data.lens = 55
scene.camera = cam


def area_light(location, energy, color, size):
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.data.energy = energy
    light.data.color = color
    light.data.shape = "DISK"
    light.data.size = size
    light.rotation_euler = (
        Vector((0, 0, 1.0)) - light.location
    ).to_track_quat("-Z", "Y").to_euler()


area_light((-3.2, -3.0, 3.4), 700, (0.45, 0.8, 1.0), 4.0)
area_light((3.0, -2.2, 2.0), 850, (1.0, 0.65, 0.28), 3.0)
area_light((0.0, 2.5, 2.5), 500, (0.3, 0.9, 1.0), 3.0)

world = scene.world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
background.inputs[0].default_value = (0.015, 0.02, 0.035, 1)
background.inputs[1].default_value = 0.35

bpy.ops.render.render(write_still=True)
print("Rendu :", DEST)
