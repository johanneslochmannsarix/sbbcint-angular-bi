"""routing.error_response: request-side failures map to 4xx, never to an unhandled 500."""
import json

from app.core import datasets as D
from app.core import queries as Q
from app.core.routing import error_response


def test_unknown_dataset_is_a_400_not_a_500():
    # core-requests-ac13 #1: env=PROD while a model is registered in QA only
    r = error_response(D.UnknownDataset("no dataset registered for nachbereitung_cd/CARGOCONTROL/PROD"))
    assert r.status_code == 400
    assert json.loads(r.body)["error"] == "no dataset registered for nachbereitung_cd/CARGOCONTROL/PROD"


def test_param_error_stays_a_400():
    assert error_response(Q.ParamError("bad")).status_code == 400
