"""Non-régression du diagnostic des erreurs Riot API."""

import urllib.error
import unittest
from unittest.mock import patch

from backend.switcher import riot_api


class RiotApiErrorTests(unittest.TestCase):
    @staticmethod
    def _http_error(status: int) -> urllib.error.HTTPError:
        return urllib.error.HTTPError(
            "https://europe.api.riotgames.com/test",
            status,
            "test",
            {},
            None,
        )

    def test_401_est_identifie_comme_cle_refusee(self):
        client = riot_api.RiotClient(key="RGAPI-test")
        with patch.object(riot_api.urllib.request, "urlopen", side_effect=self._http_error(401)):
            with self.assertRaises(riot_api.RiotApiError) as ctx:
                client._get("europe", "/test")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("invalide ou expirée", str(ctx.exception))

    def test_403_reste_un_refus_endpoint_et_ne_devient_pas_expiration(self):
        client = riot_api.RiotClient(key="RGAPI-test")
        with patch.object(riot_api.urllib.request, "urlopen", side_effect=self._http_error(403)):
            with self.assertRaises(riot_api.RiotApiError) as ctx:
                client._get("europe", "/test")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("pas forcément expirée", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
