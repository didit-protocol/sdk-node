# Changelog

## [2.18.0](https://github.com/didit-protocol/sdk-node/compare/v2.17.0...v2.18.0) (2026-11-14)


### Features

* **spec:** sync API spec 2026-11-14 ([639aa16](https://github.com/didit-protocol/sdk-node/commit/639aa16976bc25c1bbb85e554a71a58a505aadc3))

## [2.17.0](https://github.com/didit-protocol/sdk-node/compare/v2.16.0...v2.17.0) (2026-11-14)


### Features

* **spec:** sync API spec 2026-11-14 ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))


### API changes that can break typed code

* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/networks/` response field `networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/settings/` response field `networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `GET /v3/travel-rule/workspace/` response field `settings.networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/billing/` response field `settings.networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/claim/` response field `settings.networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/confirm/` response field `settings.networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `POST /v3/travel-rule/workspace/domain/dns/` response field `settings.networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.gtr.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.sygna.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.trust.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.connected` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.platform_available` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.reason` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.routed_30d` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.state` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))
* **spec:** `PUT /v3/travel-rule/settings/` response field `networks.verifyvasp.vasps_reachable` can now be null ([6e6fb7a](https://github.com/didit-protocol/sdk-node/commit/6e6fb7adaab7d411598e829cc6028623f1f29277))

## [2.16.0](https://github.com/didit-protocol/sdk-node/compare/v2.15.0...v2.16.0) (2026-11-13)


### Features

* **spec:** sync API spec 2026-11-13 ([2969d9a](https://github.com/didit-protocol/sdk-node/commit/2969d9aa07bd4093d66d00c80f5039a542dbbc5a))

## [2.15.0](https://github.com/didit-protocol/sdk-node/compare/v2.14.0...v2.15.0) (2026-11-13)


### Features

* **spec:** sync API spec 2026-11-13 ([e7b4e73](https://github.com/didit-protocol/sdk-node/commit/e7b4e73cf40be94c26bde84dc99a8bda9cf77353))

## [2.14.0](https://github.com/didit-protocol/sdk-node/compare/v2.13.1...v2.14.0) (2026-11-12)


### Features

* **spec:** sync API spec 2026-11-12 ([a76e279](https://github.com/didit-protocol/sdk-node/commit/a76e2799a6f73f3fc9b33ac019c06de35f12d6f8))


### API changes that can break typed code

* **spec:** `POST /v3/organization/{organization_id}/application/{application_id}/cases/` request field `links[].entity_type` was added and is required ([a76e279](https://github.com/didit-protocol/sdk-node/commit/a76e2799a6f73f3fc9b33ac019c06de35f12d6f8))
* **spec:** `POST /v3/organization/{organization_id}/application/{application_id}/cases/` request field `links[].entity_uuid` was added and is required ([a76e279](https://github.com/didit-protocol/sdk-node/commit/a76e2799a6f73f3fc9b33ac019c06de35f12d6f8))
* **spec:** `POST /v3/organization/{organization_id}/application/{application_id}/cases/blueprints/{blueprint_uuid}/publish/` response field `content_config` changed type from any to object ([a76e279](https://github.com/didit-protocol/sdk-node/commit/a76e2799a6f73f3fc9b33ac019c06de35f12d6f8))

## [2.13.1](https://github.com/didit-protocol/sdk-node/compare/v2.13.0...v2.13.1) (2026-11-12)


### Bug Fixes

* **authentication:** a failure to encode a consent request has a fixed message ([7f3abae](https://github.com/didit-protocol/sdk-node/commit/7f3abae8e96b410dbafd4739955d85e466b424c5))
* **authentication:** a malformed 2xx consent error keeps no parser exception as its cause ([1431828](https://github.com/didit-protocol/sdk-node/commit/14318281c148b5270f202341b3f009d18c78496f))
* **authentication:** a malformed 2xx consent message reads the content type from the sanitized response ([cf8e825](https://github.com/didit-protocol/sdk-node/commit/cf8e82571ea264bbdb1499da612986bbfc12107e))
* **authentication:** collect consent secrets from the JSON the request carries ([e88d44a](https://github.com/didit-protocol/sdk-node/commit/e88d44a2b751b2fdf74f31bb9c0f1ab540c55e8f))
* **authentication:** read consent secrets from the bytes that were sent ([7d39bfe](https://github.com/didit-protocol/sdk-node/commit/7d39bfe555a891b08891d3f4a9016c36352f9aeb))
* **authentication:** redact the parsed agent-consent response structurally ([7f765d2](https://github.com/didit-protocol/sdk-node/commit/7f765d2ecf43bbd1aae6a9b8f71ae8a753a547de))
* **authentication:** redact the parsed agent-consent response, not its raw text ([39b40ca](https://github.com/didit-protocol/sdk-node/commit/39b40cae2a76e0e3501db3d07f7e21eb7385cf01))
* **authentication:** sanitize the whole consent response once on receipt ([4904ffd](https://github.com/didit-protocol/sdk-node/commit/4904ffda40242117276f0e0f99e12f953a68267b))
* **authentication:** successful consent responses reach the caller unchanged; fold header-name case ([396ad57](https://github.com/didit-protocol/sdk-node/commit/396ad57cc2071dfd6079e8ba65e1ea104585ff98))
* **authentication:** the debug log of a consent call never records a raw request id ([14a74b1](https://github.com/didit-protocol/sdk-node/commit/14a74b1656cf39a8aa962a52ca32675d6d4f9991))
* **authentication:** treat only assertion strings of 16+ characters as secrets ([9c753e7](https://github.com/didit-protocol/sdk-node/commit/9c753e70fd081205c1a7d58a2936f11ada0ea76d))
* **authentication:** withhold transport causes, redact empty bodies, keep safe key names ([c919bbc](https://github.com/didit-protocol/sdk-node/commit/c919bbc9771e26159c9f2fe733ca0390ef61d42f))

## [2.13.0](https://github.com/didit-protocol/sdk-node/compare/v2.12.0...v2.13.0) (2026-11-11)


### Features

* **spec:** sync API spec 2026-11-11 ([776db4b](https://github.com/didit-protocol/sdk-node/commit/776db4bbc576e9784c8eba371b04c65cc5362ed1))

## [2.12.0](https://github.com/didit-protocol/sdk-node/compare/v2.11.1...v2.12.0) (2026-11-11)


### Features

* **spec:** sync API spec 2026-11-11 ([10448c6](https://github.com/didit-protocol/sdk-node/commit/10448c6eecc3e8d5322e800d93c54b573f62780e))

## [2.11.1](https://github.com/didit-protocol/sdk-node/compare/v2.11.0...v2.11.1) (2026-11-11)


### Bug Fixes

* **authentication:** redact every string of the consent assertion from errors ([#57](https://github.com/didit-protocol/sdk-node/issues/57)) ([c89ff1b](https://github.com/didit-protocol/sdk-node/commit/c89ff1b66fc97f3a0e7637d01e1e9c9d8b8c5ef9))

## [2.11.0](https://github.com/didit-protocol/sdk-node/compare/v2.10.0...v2.11.0) (2026-11-11)


### Features

* **spec:** sync API spec 2026-11-11 ([8fe198f](https://github.com/didit-protocol/sdk-node/commit/8fe198f0cdd28c19009241733124fbf4a953008c))
* **spec:** sync API spec 2026-11-11 ([7941748](https://github.com/didit-protocol/sdk-node/commit/7941748c2480d2ace6f4a98f6f4bfe3aed0b921f))
* **spec:** sync API spec 2026-11-11 ([1c225b8](https://github.com/didit-protocol/sdk-node/commit/1c225b80c2eaa4062717e00f91343e880dcf2f39))
* **spec:** sync API spec 2026-11-11 ([2081c0f](https://github.com/didit-protocol/sdk-node/commit/2081c0fe1a9d12687c0e599b3b32ded76c8c019e))
* **spec:** sync API spec 2026-11-11 ([69e1670](https://github.com/didit-protocol/sdk-node/commit/69e1670a8380ef43a37d068c10dc474705e2b46a))

## [2.10.0](https://github.com/didit-protocol/sdk-node/compare/v2.9.0...v2.10.0) (2026-11-11)


### Features

* **spec:** sync API spec 2026-11-10 ([eec1219](https://github.com/didit-protocol/sdk-node/commit/eec1219150d292563efb25fc18b4f4c982bbdfd8))
* **spec:** sync API spec 2026-11-11 ([3789131](https://github.com/didit-protocol/sdk-node/commit/3789131e4390fe2c6c69fbb3f0d1c3a1279c3546))

## [2.9.0](https://github.com/didit-protocol/sdk-node/compare/v2.8.0...v2.9.0) (2026-11-10)


### Features

* **spec:** sync API spec 2026-11-10 ([a5376a3](https://github.com/didit-protocol/sdk-node/commit/a5376a3f162d6c810c955f9829f3d744ccc613d4))

## [2.8.0](https://github.com/didit-protocol/sdk-node/compare/v2.7.0...v2.8.0) (2026-11-10)


### Features

* **spec:** sync API spec 2026-11-10 ([fd3ccb8](https://github.com/didit-protocol/sdk-node/commit/fd3ccb8a1bc5c63e842b52ba162136cdb68ca9d2))

## [2.7.0](https://github.com/didit-protocol/sdk-node/compare/v2.6.0...v2.7.0) (2026-11-10)


### Features

* **spec:** sync API spec 2026-11-10 ([780b7ab](https://github.com/didit-protocol/sdk-node/commit/780b7ab3c33765ac82ae4c0ddf8cdb8b19d8d14d))

## [2.6.0](https://github.com/didit-protocol/sdk-node/compare/v2.5.0...v2.6.0) (2026-11-10)


### Features

* **spec:** sync API spec 2026-11-10 ([fb6463c](https://github.com/didit-protocol/sdk-node/commit/fb6463c2313f442058213ca7a39d1be9b6290b67))

## [2.5.0](https://github.com/didit-protocol/sdk-node/compare/v2.4.0...v2.5.0) (2026-11-10)


### Features

* **spec:** sync API spec 2026-11-10 ([327dcd1](https://github.com/didit-protocol/sdk-node/commit/327dcd1d7cec0537b281534c80acf1d4fce3b25e))

## [2.4.0](https://github.com/didit-protocol/sdk-node/compare/v2.3.0...v2.4.0) (2026-11-09)


### Features

* **spec:** sync API spec 2026-11-09 ([faf3cff](https://github.com/didit-protocol/sdk-node/commit/faf3cfff132f950ba4b59f8bf4de5b2db07feecc))

## [2.3.0](https://github.com/didit-protocol/sdk-node/compare/v2.2.0...v2.3.0) (2026-11-07)


### Features

* **spec:** sync API spec 2026-11-07 ([2d40c00](https://github.com/didit-protocol/sdk-node/commit/2d40c003e4ea161fedde9d9407f4a0aef6146808))

## [2.2.0](https://github.com/didit-protocol/sdk-node/compare/v2.1.0...v2.2.0) (2026-11-07)


### Features

* **spec:** sync API spec 2026-11-07 ([a2e271a](https://github.com/didit-protocol/sdk-node/commit/a2e271aff409568fa17f181104397b1b41e70e1d))

## [2.1.0](https://github.com/didit-protocol/sdk-node/compare/v2.0.0...v2.1.0) (2026-11-05)


### Features

* **spec:** sync API spec 2026-11-05 ([73f3a55](https://github.com/didit-protocol/sdk-node/commit/73f3a55e6a3d9b2f353205608045544f587a7a26))

## [2.0.0](https://github.com/didit-protocol/sdk-node/compare/v1.0.1...v2.0.0) (2026-11-05)


### ⚠ BREAKING CHANGES

* **spec:** sync API spec 2026-11-04
* **spec:** sync API spec 2026-11-04

### Features

* **spec:** sync API spec 2026-11-04 ([5efe2c7](https://github.com/didit-protocol/sdk-node/commit/5efe2c723041e9b7a41fe124cdd6cfd2262c84e3))
* **spec:** sync API spec 2026-11-04 ([d913ce6](https://github.com/didit-protocol/sdk-node/commit/d913ce64548b45c7672fc031c56006c2f1b0c0db))

## [1.0.1](https://github.com/didit-protocol/sdk-node/compare/v1.0.0...v1.0.1) (2026-10-29)


### Miscellaneous Chores

* release 1.0.1 ([c8b40f9](https://github.com/didit-protocol/sdk-node/commit/c8b40f9fdc2189b17bb9cab83817d4adeb8c54ed))

## [1.0.0](https://github.com/didit-protocol/sdk-node/compare/v0.1.0...v1.0.0) (2026-10-29)


### ⚠ BREAKING CHANGES

* **spec:** sync API spec 2026-10-23

### Features

* **spec:** sync API spec 2026-10-23 ([17a1d81](https://github.com/didit-protocol/sdk-node/commit/17a1d8168b441a4a3c55604e53addcaad21ec9e4))
* **spec:** sync API spec 2026-10-23 ([af0c92f](https://github.com/didit-protocol/sdk-node/commit/af0c92f99efe2e9f109cbbbf2c5ca5bfd814ce4f))
* **spec:** sync API spec 2026-10-26 ([0711a5f](https://github.com/didit-protocol/sdk-node/commit/0711a5f65a0c9ad74d86b2e8625bb93f5fa6a901))
* **spec:** sync API spec 2026-10-27 ([59cccdf](https://github.com/didit-protocol/sdk-node/commit/59cccdf2a5fde5fa94fff8285b682c6c0cddf8b9))
* **spec:** sync API spec 2026-10-29 ([bb63469](https://github.com/didit-protocol/sdk-node/commit/bb6346916d0c03ff77eff03745f44282b30da7ea))


### Miscellaneous Chores

* release 1.0.0 ([fc33f40](https://github.com/didit-protocol/sdk-node/commit/fc33f40c4acd7a30d0754e67965ab244511dc0ed))
