# Campus Sentinel — stubs until services land.
.PHONY: up demo reset bench api check help

help:
	@echo "make api    # run services/api on :8080"
	@echo "make check  # brain + api self-checks"
	@echo "make up     # docker compose up api"
	@echo "make demo   # pre-warm + scenario (partial)"
	@echo "make reset  # reset demo state (not wired yet)"
	@echo "make bench  # run benchmarks (not wired yet)"

api:
	PYTHONPATH=. python3 -m services.api --host 127.0.0.1 --port 8080

check:
	python3 services/brain/check.py
	python3 services/api/check.py

up:
	docker compose up --build api

demo:
	@echo "Start api (make api), then: cd web && python3 -m http.server 8000"
	@echo "Set web/js/config.js SOURCE to 'live' and API_BASE to http://127.0.0.1:8080"

reset:
	@echo "TODO: POST reset via WS cmd — use dashboard Reset or send {\"cmd\":\"reset\"}"

bench:
	@echo "TODO: make bench — Naman"
	@exit 1
