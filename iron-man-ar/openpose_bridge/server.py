import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np


HOST = "127.0.0.1"
PORT = 8765
MAX_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
BODY25_TO_LANDMARK = {
    0: 0,
    2: 12,
    3: 14,
    4: 16,
    5: 11,
    6: 13,
    7: 15,
    9: 24,
    10: 26,
    11: 28,
    12: 23,
    13: 25,
    14: 27,
}

pose_wrapper = None
pose_lock = threading.Lock()
dll_handles = []


def map_body25_keypoints(keypoints, width, height):
    landmarks = [None] * 29
    if keypoints is None:
        return landmarks

    for source_index, landmark_index in BODY25_TO_LANDMARK.items():
        x, y, confidence = keypoints[source_index]
        if confidence <= 0 or width <= 0 or height <= 0:
            continue
        landmarks[landmark_index] = {
            "x": min(1.0, max(0.0, float(x) / width)),
            "y": min(1.0, max(0.0, float(y) / height)),
            "visibility": min(1.0, max(0.0, float(confidence))),
        }
    return landmarks


def load_openpose():
    global pose_wrapper

    openpose_home = os.environ.get("OPENPOSE_HOME")
    if not openpose_home:
        raise RuntimeError("Définis OPENPOSE_HOME vers le dossier d'installation d'OpenPose.")

    root = Path(openpose_home).resolve()
    python_binding = root / "python" / "openpose" / "Release"
    release_bin = root / "x64" / "Release"
    bin_dir = root / "bin"
    model_dir = root / "models"
    for required in (python_binding, release_bin, bin_dir, model_dir):
        if not required.exists():
            raise RuntimeError(f"Dossier OpenPose introuvable : {required}")

    sys.path.insert(0, str(python_binding))
    for dll_dir in (release_bin, bin_dir):
        dll_handles.append(os.add_dll_directory(str(dll_dir)))

    try:
        import pyopenpose as op
    except ImportError as exc:
        raise RuntimeError(
            "Liaison pyopenpose introuvable. Recompile OpenPose avec BUILD_PYTHON "
            "pour la même version de Python que celle qui lance ce serveur."
        ) from exc

    params = {
        "model_folder": str(model_dir),
        "model_pose": "BODY_25",
        "net_resolution": "-1x368",
        "number_people_max": "1",
    }
    pose_wrapper = op.WrapperPython()
    pose_wrapper.configure(params)
    pose_wrapper.start()


class PoseHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _add_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self._send_json(403, {"error": "Origine non autorisée."})
            return
        self.send_response(204)
        self._add_cors_headers()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path != "/health":
            self._send_json(404, {"error": "Route introuvable."})
            return
        self._send_json(200, {"ready": pose_wrapper is not None})

    def do_POST(self):
        if urlparse(self.path).path != "/pose":
            self._send_json(404, {"error": "Route introuvable."})
            return
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            self._send_json(403, {"error": "Origine non autorisée."})
            return
        if self.headers.get_content_type() != "image/jpeg":
            self._send_json(415, {"error": "Une image JPEG est requise."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Longueur de requête invalide."})
            return
        if content_length <= 0 or content_length > MAX_IMAGE_BYTES:
            self._send_json(413, {"error": "Image vide ou trop volumineuse."})
            return

        image_bytes = self.rfile.read(content_length)
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            self._send_json(400, {"error": "Image JPEG illisible."})
            return

        try:
            with pose_lock:
                datum = op.Datum()
                datum.cvInputData = image
                pose_wrapper.emplaceAndPop(op.VectorDatum([datum]))
                poses = datum.poseKeypoints
            keypoints = poses[0] if poses is not None and len(poses) else None
            height, width = image.shape[:2]
            self._send_json(
                200,
                {"landmarks": map_body25_keypoints(keypoints, width, height)},
            )
        except Exception as exc:
            self.log_error("OpenPose a échoué : %s", exc)
            self._send_json(500, {"error": "L'inférence OpenPose a échoué."})

    def log_message(self, format_string, *args):
        if self.command != "POST":
            super().log_message(format_string, *args)


def main():
    global op
    load_openpose()
    import pyopenpose as op

    server = ThreadingHTTPServer((HOST, PORT), PoseHandler)
    print(f"OpenPose BODY_25 prêt sur http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du service OpenPose.")
    finally:
        server.server_close()
        if pose_wrapper is not None:
            pose_wrapper.stop()


if __name__ == "__main__":
    main()
