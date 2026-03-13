# Changelog

All notable changes to k8n will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- WebSocket support for real-time cluster updates
- Multi-cluster management
- Advanced YAML editor with Monaco
- AI-powered resource generation
- Cost analysis and optimization
- Collaboration features
- Plugin system

## [0.2.0] - 2024-03-13

### Added
- ComfyUI-style typed connections with color coding
- Double-click to rename nodes inline
- Workflow Manager with save/load functionality
- Example workflow templates (Nginx starter)
- Keyboard shortcuts (Ctrl+S, Ctrl+R, Ctrl+Z, Delete, ?)
- Undo/Redo functionality (up to 50 actions)
- Real-time status indicators (Running, Pending, Failed)
- Connection validation (type-safe connections)
- Namespace filtering in toolbar
- Dev mode indicator
- Help page with documentation
- Deployed resources view
- Helm chart search and integration
- CRD auto-discovery
- Database persistence for workflows
- Export/Import workflows as JSON
- Smart cluster import (filters system resources)
- Automated installation scripts (install.sh, install.bat)
- Quick start/stop scripts
- Comprehensive documentation

### Changed
- Improved node design with expand/collapse
- Better error handling and validation
- Enhanced UI with professional styling
- Optimized auto-layout algorithm
- Improved connection handles (larger, more visible)

### Fixed
- React controlled input warnings
- CORS security issues
- Nil pointer errors in backend
- Connection validation logic
- Namespace handling
- Status indicator colors

## [0.1.0] - 2024-01-15

### Added
- Initial release
- Visual canvas with React Flow
- Drag & drop resource creation
- Basic Kubernetes integration
- Cluster connection via kubectl contexts
- Resource visualization
- Apply to cluster functionality
- Node property editing
- Basic Helm support
- PostgreSQL database integration
- Auto-layout for resources
- Edge relationship detection

### Known Issues
- No real-time updates (WebSocket not implemented)
- Helm installation is mocked
- No authentication/authorization
- Limited error messages
- No multi-cluster support

---

## Version History

- **0.2.0** - Major feature update with ComfyUI-style improvements
- **0.1.0** - Initial MVP release

## Upgrade Guide

### From 0.1.0 to 0.2.0

1. Pull latest changes:
```bash
git pull origin main
```

2. Update dependencies:
```bash
cd apps/web && npm install
cd ../api && go mod download
```

3. Run database migrations (if any):
```bash
docker-compose down
docker-compose up -d
```

4. Restart services:
```bash
./start.sh  # or manually restart backend and frontend
```

No breaking changes in this release. Existing workflows will continue to work.

---

[Unreleased]: https://github.com/yourusername/k8n/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yourusername/k8n/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yourusername/k8n/releases/tag/v0.1.0
