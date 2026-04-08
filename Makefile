# ==============================================================================
# VynX MVP — Root Makefile
#
# Provides a unified interface for building, running, and tearing down the
# full settlement stack. Designed for the one-click grant reviewer experience.
# ==============================================================================

.PHONY: reviewer-demo up down clean

# ── reviewer-demo ─────────────────────────────────────────────────────────────
# Primary target for grant reviewers.
# Builds all Docker images from source, starts all services in detached mode,
# and attaches to the aggregated log stream for live observation.
reviewer-demo:
	@echo ""
	@echo "============================================================"
	@echo "  VynX MVP — Initializing Settlement Stack"
	@echo "  Coinbase AgentKit × CDP MPC Wallets × Base L2"
	@echo "============================================================"
	@echo ""
	@echo "  Building images and starting services..."
	@echo ""
	docker compose up --build -d
	@echo ""
	@echo "  All services are running. Streaming live logs:"
	@echo "  (Press Ctrl+C to detach — services will continue running)"
	@echo ""
	docker compose logs -f

# ── up ────────────────────────────────────────────────────────────────────────
# Start all services in detached mode using cached images.
up:
	docker compose up -d

# ── down ──────────────────────────────────────────────────────────────────────
# Stop and remove all containers. Volumes and images are preserved.
down:
	docker compose down

# ── clean ─────────────────────────────────────────────────────────────────────
# Stop all containers, remove volumes, orphaned containers, and dangling images.
# Use this to perform a full environment reset.
clean:
	docker compose down --volumes --remove-orphans
	docker image prune -f
