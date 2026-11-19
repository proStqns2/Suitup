import unittest

from server import map_body25_keypoints


class MapBody25KeypointsTests(unittest.TestCase):
    def test_maps_openpose_body25_to_mediapipe_indices(self):
        keypoints = [[0.0, 0.0, 0.0] for _ in range(25)]
        keypoints[5] = [100.0, 80.0, 0.9]
        keypoints[12] = [120.0, 180.0, 0.8]

        landmarks = map_body25_keypoints(keypoints, 200, 200)

        self.assertEqual(landmarks[11], {"x": 0.5, "y": 0.4, "visibility": 0.9})
        self.assertEqual(landmarks[23], {"x": 0.6, "y": 0.9, "visibility": 0.8})
        self.assertIsNone(landmarks[12])

    def test_empty_pose_returns_missing_landmarks(self):
        self.assertEqual(map_body25_keypoints(None, 640, 480), [None] * 29)

    def test_clamps_out_of_frame_coordinates(self):
        keypoints = [[0.0, 0.0, 0.0] for _ in range(25)]
        keypoints[0] = [700.0, -10.0, 1.2]

        self.assertEqual(
            map_body25_keypoints(keypoints, 640, 480)[0],
            {"x": 1.0, "y": 0.0, "visibility": 1.0},
        )


if __name__ == "__main__":
    unittest.main()
