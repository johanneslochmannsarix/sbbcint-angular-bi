"""Dataset registry: (model, tenant, env) -> (workspace id, dataset id). The ONLY datasets the demo may query.

Checked 2026-10-21 (D0) against docs/reference/workspace-inventory.md (generated, verified 2026-10-16 via
Fabric REST; each id sits under the workspace section named here) and, where a report exists, against the
report's definition.pbir `semanticmodelid`:

| key                                  | inventory | definition.pbir                                   |
|--------------------------------------|-----------|---------------------------------------------------|
| import / CARGOCONTROL / PROD         | yes       | Auswertung Qualifikationen CargoControl_1.0 (prod) |
| import / CARGOCONTROL / QA           | yes       | Auswertung Qualifikationen CargoControl_1.0 (qa)   |
| import / RTS / PROD                  | yes       | Qualifikationen RT&S (prod)                       |
| import / RTS / QA                    | yes       | Qualifikationen RT&S (qa)                         |
| leitstelle_olten / CARGOCONTROL / *  | yes       | none - we deliver no report on it (PLAN §13.1)     |
| platform_metrics                     | yes       | rpt_platform_metrics                              |
| fico / CARGOCONTROL / PROD           | yes       | FiCo Produktivität CargoControl (prod, 3a44e02d)  |
| fico / CARGOCONTROL / QA             | yes       | FiCo Produktivität CargoControl (qa, 90e34382)    |
| offene_schichten / CARGOCONTROL / PROD | yes     | rpt_offene_schichten (prod, 3f675c90)             |
| offene_schichten / CARGOCONTROL / QA   | yes     | rpt_offene_schichten (qa, cf276561)               |
| au_verleihliste / RTS / PROD         | yes       | AUE-Verleihliste RDL (generator, prod)            |
| au_verleihliste / RTS / QA           | yes       | AUE-Verleihliste RDL (generator, qa)              |

fico (sm_fico, AC-4) added 2026-10-21 by the AC-4 session: both ids under their workspace sections of the
inventory and equal to the `sm_id` the report generator scripts/build_report_fico.py binds per env.
offene_schichten (sm_offene_schichten, AC-10) added 2026-10-21 by the AC-10 session: both ids under their
workspace sections of the inventory, equal to both mirrors' definition.pbir `semanticmodelid` and to the
`sm_id` scripts/build_report_offene_schichten.py binds per env.
au_verleihliste (sm_au_verleihliste, AC-7) added 2026-10-21 by the AC-7 session: both ids under their workspace
sections of the inventory and equal to the `model_id` scripts/ac7/build_verleihliste_rdl.py binds per env (the
paginated RDL has no definition.pbir). RT&S only.
rechnungslegung (sm_rechnungslegung_rts, AC-9) added 2026-10-21 by the AC-9 session: both ids under their
workspace sections of the inventory and equal to the `sm_id` scripts/ac9/build_report_rechnungslegung.py binds
per env; QA also equals the landing report's definition.pbir `semanticmodelid` and the RDL's model id (the
landing report and the RDL exist in RTS QA only, the PROD mirror holds the model alone). RT&S only.
nachbereitung_cd (sm_nachbereitung_cd, AC-13) added 2026-10-21 by the AC-13 session, CC QA only: the model was
created at 17:08; the id was first confirmed by a live read-only list_items of
WORKSPACE_CARGOCONTROL_QA, the QA mirror's definition.pbir `semanticmodelid` and the `sm_id` that
scripts/build_report_nachbereitung_cd.py binds for qa. PROD is added only once the model exists there (planned
Thursday 2026-10-22), re-checked the same way.

Never add a dataset here without the same check. LOCLOCATION is not ours and never appears.
"""
from __future__ import annotations

from dataclasses import dataclass

ENVS = ("PROD", "QA")
TENANTS = ("CARGOCONTROL", "RTS")
MODELS = ("import", "leitstelle_olten", "platform_metrics", "fico", "offene_schichten", "au_verleihliste",
          "rechnungslegung", "nachbereitung_cd")
# models whose dataset is picked by tenant + env; platform_metrics is one dataset for everything
SELECTED_BY_TENANT_ENV = frozenset({"import", "leitstelle_olten", "fico", "offene_schichten", "au_verleihliste",
                                    "rechnungslegung", "nachbereitung_cd"})

WS_CC_PROD = "c6786e7b-23c1-4aa9-b17b-ccb64d49cde8"
WS_CC_QA = "054654e7-9f65-46cb-9e24-eb94c438253c"
WS_RTS_PROD = "221c17fa-f3d1-4377-a502-db250532b5bc"
WS_RTS_QA = "ff4694c8-80df-42f8-b29a-9232e262ad7f"
WS_PLAYGROUND = "b95aee44-16ba-478c-8a3a-d96c2b240647"


@dataclass(frozen=True)
class Dataset:
    model: str
    tenant: str | None
    env: str | None
    workspace_id: str
    dataset_id: str
    name: str
    confirmed: str          # how the id was confirmed (see module docstring)

    @property
    def key(self) -> str:
        return "/".join(x for x in (self.model, self.tenant, self.env) if x)

    @property
    def url(self) -> str:
        return (f"https://api.powerbi.com/v1.0/myorg/groups/{self.workspace_id}"
                f"/datasets/{self.dataset_id}/executeQueries")


REGISTRY: dict[tuple[str, str | None, str | None], Dataset] = {
    d[:3]: Dataset(*d) for d in [
        ("import", "CARGOCONTROL", "PROD", WS_CC_PROD, "9a305370-b812-475a-bcba-a8eaac11b824",
         "semantic_model_CARGOCONTROL_PROD__IMPORT", "inventory + definition.pbir"),
        ("import", "CARGOCONTROL", "QA", WS_CC_QA, "603ce0cd-be45-46af-ab7f-6fb76ecbaea2",
         "semantic_model_CARGOCONTROL_QA__IMPORT", "inventory + definition.pbir"),
        ("import", "RTS", "PROD", WS_RTS_PROD, "eb726e1b-4e49-42f8-b4e8-d777fc1fa245",
         "semantic_model_RTS_PROD__IMPORT", "inventory + definition.pbir"),
        ("import", "RTS", "QA", WS_RTS_QA, "ce78c204-794f-4582-8332-d2561ed2e97c",
         "semantic_model_RTS_QA__IMPORT", "inventory + definition.pbir"),
        ("leitstelle_olten", "CARGOCONTROL", "PROD", WS_CC_PROD, "d5dfa266-5b84-4d94-ad83-7aefa7a8ca32",
         "sm_leitstelle_olten", "inventory"),
        ("leitstelle_olten", "CARGOCONTROL", "QA", WS_CC_QA, "842439cc-6bb6-4e20-8e15-7204d851ef54",
         "sm_leitstelle_olten", "inventory"),
        ("platform_metrics", None, None, WS_PLAYGROUND, "e668ce4f-e06d-478b-92b8-3b79b4767d17",
         "sm_platform_metrics", "inventory + definition.pbir"),
        ("fico", "CARGOCONTROL", "PROD", WS_CC_PROD, "488fad6b-6417-4f7f-9d7b-b41ce1a49ff2",
         "sm_fico", "inventory + report generator"),
        ("fico", "CARGOCONTROL", "QA", WS_CC_QA, "fcbc592a-a112-4501-8786-c65471432b8c",
         "sm_fico", "inventory + report generator"),
        ("offene_schichten", "CARGOCONTROL", "PROD", WS_CC_PROD, "5d5b844f-d9e1-4bcf-86bb-e4d287a4c219",
         "sm_offene_schichten", "inventory + definition.pbir + report generator"),
        ("offene_schichten", "CARGOCONTROL", "QA", WS_CC_QA, "ed8fabbc-bfc6-40b5-8c54-9fa1223dde10",
         "sm_offene_schichten", "inventory + definition.pbir + report generator"),
        ("au_verleihliste", "RTS", "PROD", WS_RTS_PROD, "2631d163-f6ee-474b-a994-46b6dfdf98b7",
         "sm_au_verleihliste", "inventory + RDL generator"),
        ("au_verleihliste", "RTS", "QA", WS_RTS_QA, "bc9fcbe3-a455-4a50-addb-f1f8cfcb77dc",
         "sm_au_verleihliste", "inventory + RDL generator"),
        ("rechnungslegung", "RTS", "PROD", WS_RTS_PROD, "0789cd46-64c1-4b0f-b25a-383df1af6a24",
         "sm_rechnungslegung_rts", "inventory + report generator"),
        ("rechnungslegung", "RTS", "QA", WS_RTS_QA, "df0ce5da-42fb-476a-a697-0316a38d7bba",
         "sm_rechnungslegung_rts", "inventory + definition.pbir + report generator + RDL"),
        ("nachbereitung_cd", "CARGOCONTROL", "QA", WS_CC_QA, "d94ec3d0-7cf0-4683-9057-d95763cafe78",
         "sm_nachbereitung_cd", "inventory"),
    ]
}


class UnknownDataset(KeyError):
    pass


def lookup(model: str, tenant: str | None, env: str | None) -> Dataset:
    if model not in SELECTED_BY_TENANT_ENV:
        tenant = env = None
    try:
        return REGISTRY[(model, tenant, env)]
    except KeyError:
        raise UnknownDataset(f"no dataset registered for {model}/{tenant}/{env}") from None


def tenants_for(model: str) -> tuple[str, ...]:
    return tuple(sorted({t for (m, t, _e) in REGISTRY if m == model and t}))
