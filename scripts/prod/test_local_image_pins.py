import unittest

from local_image_pins import render_local_image_pins


class LocalImagePinsTest(unittest.TestCase):
    def test_pins_non_core_services_to_running_image_ids(self):
        services = {"voicechat": {"build": {}}, "billing": {}, "identity": {}}
        rendered = render_local_image_pins(
            services, lambda name: ("local/" + name + ":stable", "sha256:" + ("a" if name == "billing" else "b") * 64)
        )
        self.assertIn('billing:\n    build: !reset null\n    image: "local/billing:stable"', rendered)
        self.assertIn('identity:\n    build: !reset null\n    image: "local/identity:stable"', rendered)
        self.assertNotIn("voicechat:", rendered)
        self.assertNotIn("ghcr.io", rendered)

    def test_missing_or_unverified_image_stops_release(self):
        services = {"voicechat": {}, "billing": {}}
        for value in ("", "invalid"):
            with self.assertRaisesRegex(ValueError, "No verified local image for billing"):
                render_local_image_pins(services, lambda _: ("local/billing:stable", value))
        with self.assertRaisesRegex(ValueError, "Core service is missing"):
            render_local_image_pins({"billing": {}}, lambda _: ("local/billing:stable", "sha256:" + "a" * 64))


    def test_release_moved_service_uses_the_pulled_image(self):
        services = {"voicechat": {}, "make": {}, "billing": {}}
        rendered = render_local_image_pins(
            services,
            lambda name: ("local/" + name + ":stable", "sha256:" + "a" * 64),
            {"make": "ghcr.io/sislex/make-api:" + "b" * 40},
            lambda reference: "sha256:" + "c" * 64,
        )
        self.assertIn('make:\n    build: !reset null\n    image: "ghcr.io/sislex/make-api:' + "b" * 40 + '"', rendered)
        self.assertIn('image: "local/billing:stable"', rendered)
        with self.assertRaisesRegex(ValueError, "No verified local image for make"):
            render_local_image_pins(services, lambda name: ("local/x", "sha256:" + "a" * 64), {"make": "ghcr.io/sislex/make-api:" + "b" * 40}, lambda reference: "")


if __name__ == "__main__":
    unittest.main()
