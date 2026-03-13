# Contributing to k8n

Thank you for your interest in contributing to k8n! This document provides guidelines and instructions for contributing.

## 🚀 Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/k8n.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes
6. Commit: `git commit -m 'Add some feature'`
7. Push: `git push origin feature/your-feature-name`
8. Open a Pull Request

## 📋 Development Setup

Follow the installation instructions in README.md to set up your development environment.

## 🎯 Areas for Contribution

### High Priority
- WebSocket implementation for real-time updates
- Comprehensive test coverage
- Advanced YAML editor with Monaco
- Multi-cluster support
- Authentication and authorization

### Medium Priority
- Additional resource type support
- Helm chart improvements
- UI/UX enhancements
- Documentation improvements
- Performance optimizations

### Good First Issues
- Bug fixes
- Documentation updates
- UI polish
- Error message improvements
- Accessibility improvements

## 🧪 Testing

### Backend Tests
```bash
cd apps/api
go test ./...
```

### Frontend Tests
```bash
cd apps/web
npm test
```

## 📝 Code Style

### Go
- Follow standard Go conventions
- Use `gofmt` to format code
- Add comments for exported functions
- Keep functions small and focused

### TypeScript/React
- Use TypeScript for type safety
- Follow React best practices
- Use functional components with hooks
- Keep components small and reusable

### Commits
- Use clear, descriptive commit messages
- Start with a verb (Add, Fix, Update, Remove)
- Reference issues when applicable

Example:
```
Add WebSocket support for real-time updates

- Implement WebSocket endpoint in backend
- Add client connection in frontend
- Update status indicators on events

Fixes #123
```

## 🐛 Reporting Bugs

When reporting bugs, please include:
- k8n version
- Operating system
- Kubernetes version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable

## 💡 Suggesting Features

When suggesting features, please include:
- Clear description of the feature
- Use case and benefits
- Potential implementation approach
- Any relevant examples or mockups

## 📄 Documentation

- Update README.md for user-facing changes
- Add code comments for complex logic
- Update API documentation for endpoint changes
- Include examples where helpful

## ✅ Pull Request Checklist

Before submitting a PR, ensure:
- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] PR description explains changes
- [ ] No merge conflicts

## 🤝 Code Review Process

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged
4. Your contribution will be credited

## 📞 Getting Help

- Open an issue for questions
- Join discussions in existing issues
- Check existing documentation

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to k8n! 🎉
