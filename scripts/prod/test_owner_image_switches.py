import unittest

from owner_image_switches import compose_pins, owner_image_switches

OLD = """services:
  make:
    image: ${SISLEXA_MAKE_IMAGE:-ghcr.io/sislex/make-api:%s}
  identity:
    image: ${SISLEXA_IDENTITY_IMAGE:-ghcr.io/sislex/identity:%s}
  kanban:
    image: ${SISLEXA_KANBAN_IMAGE:-sislexa-kanban:%s}
"""


def compose(make, identity="1" * 40, kanban="2" * 40):
    return OLD % (make, identity, kanban)


class OwnerImageSwitchesTest(unittest.TestCase):
    def test_reads_service_and_default_reference(self):
        self.assertEqual(compose_pins(compose("a" * 40))["make"], ("SISLEXA_MAKE_IMAGE", "ghcr.io/sislex/make-api:" + "a" * 40))

    def test_switches_only_images_the_release_moved(self):
        switches = owner_image_switches([compose("a" * 40)], [compose("b" * 40)], {})
        self.assertEqual(switches, {"make": "ghcr.io/sislex/make-api:" + "b" * 40})

    def test_unchanged_mutable_and_operator_pinned_images_stay(self):
        self.assertEqual(owner_image_switches([compose("a" * 40)], [compose("a" * 40)], {}), {})
        # Not an immutable GHCR owner reference: the running image stays.
        self.assertEqual(owner_image_switches([compose("a" * 40)], [compose("a" * 40, kanban="3" * 40)], {}), {})
        # The operator variable overrides the compose default on purpose.
        self.assertEqual(owner_image_switches([compose("a" * 40)], [compose("b" * 40)], {"SISLEXA_MAKE_IMAGE": "local/make:1"}), {})

    def test_a_service_new_to_the_release_is_not_switched(self):
        added = compose("a" * 40) + "  voice:\n    image: ${SISLEXA_VOICE_IMAGE:-ghcr.io/sislex/voice-stt:" + "c" * 40 + "}\n"
        self.assertEqual(owner_image_switches([compose("a" * 40)], [added], {}), {})


if __name__ == "__main__":
    unittest.main()
