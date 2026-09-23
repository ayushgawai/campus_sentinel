# Campus Sentinel — stubs until services land.
.PHONY: up demo reset bench help

help:
	@echo "make up     # docker compose up (not wired yet)"
	@echo "make demo   # pre-warm + scenario (not wired yet)"
	@echo "make reset  # reset demo state (not wired yet)"
	@echo "make bench  # run benchmarks (not wired yet)"

up:
	@echo "TODO: docker compose up — blocked on services + contracts"
	@exit 1

demo:
	@echo "TODO: make demo — blocked on api + web + scenarios"
	@exit 1

reset:
	@echo "TODO: make reset"
	@exit 1

bench:
	@echo "TODO: make bench — Naman"
	@exit 1
