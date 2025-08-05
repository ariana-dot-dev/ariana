# Contributing to Ariana IDE

Thank you for your interest in contributing to Ariana IDE! This guide will help you get started with development and understand our contribution process.

## Getting Started

### Prerequisites
- Node.js >= 24.2.0
- Rust (latest stable)
- Git
- Platform-specific dependencies (see [DEV_GUIDE.md](DEV_GUIDE.md))

### Setting Up Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/ariana-ide.git
   cd ariana-ide
   ```

2. **Install Dependencies**
   ```bash
   npm install -g just
   ```

3. **Start Development Services**
   ```bash
   # Start backend (terminal 1)
   just dev-backend
   
   # Start frontend (terminal 2)
   just dev-frontend
   ```

## Development Workflow

### Code Style and Formatting
We use automated formatting tools to maintain consistent code style:

```bash
# Format all code
just format
```

Our tooling includes:
- **Biome**: Fast formatter and linter for TypeScript/JavaScript
- **Rustfmt**: Standard Rust code formatter
- **Prettier**: For markdown and configuration files

### Project Structure
Understanding the codebase organization:

```
ariana-ide/
├── frontend/               # Node.js CLI + Tauri desktop app
│   ├── src/               # CLI source code
│   └── tauri-app/         # Desktop application
│       ├── src/           # React components and services
│       └── src-tauri/     # Rust backend for desktop app
├── db-server/             # Database server and API
├── ios-ide/               # iOS mobile application
└── docs/                  # Documentation
```

### Making Changes

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Follow existing code patterns and conventions
   - Add appropriate logging (no emojis in logs)
   - Write tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Run tests for different components
   cd frontend/tauri-app && npm test
   cd db-server && npm test
   ```

4. **Format and Validate**
   ```bash
   just format
   ```

## Code Guidelines

### TypeScript/JavaScript
- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use descriptive variable and function names
- Add JSDoc comments for public APIs
- Follow existing import/export patterns

### Rust
- Follow standard Rust conventions
- Use `cargo fmt` for formatting
- Add documentation comments (`///`) for public functions
- Handle errors explicitly, avoid `.unwrap()` in production code

### React Components
- Use functional components with hooks
- Prefer composition over inheritance
- Keep components focused and single-purpose
- Use proper TypeScript typing for props

### Services and Utilities
- Make services stateless when possible
- Use dependency injection patterns
- Add comprehensive error handling
- Include logging for debugging

## Commit Guidelines

### Commit Messages
Follow the conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(canvas): add drag and drop for terminal components
fix(auth): resolve token refresh race condition
docs(api): update authentication endpoint documentation
```

### Pull Request Process

1. **Ensure CI Passes**
   - All tests pass
   - Code is properly formatted
   - No TypeScript errors

2. **Update Documentation**
   - Update relevant README files
   - Add API documentation for new endpoints
   - Update architecture docs if needed

3. **Write Clear PR Description**
   - Explain the problem being solved
   - Describe your solution approach
   - Include screenshots for UI changes
   - Reference related issues

4. **Request Review**
   - Tag relevant maintainers
   - Be responsive to feedback
   - Make requested changes promptly

## Testing

### Frontend Testing
```bash
cd frontend/tauri-app
npm test
```

### Backend Testing  
```bash
cd db-server
npm test
```

### Integration Testing
- Test authentication flows end-to-end
- Verify API contract compatibility
- Test cross-platform build processes

## Architecture Considerations

When contributing, consider:

### Performance
- Canvas rendering optimizations
- Database query efficiency
- Memory usage in long-running processes
- Network request batching

### Security
- Input validation and sanitization
- Secure token handling
- SQL injection prevention
- XSS protection in UI components

### Scalability
- Stateless service design
- Efficient data structures
- Proper error handling and recovery
- Resource cleanup

## Component-Specific Guidelines

### Canvas System
- Follow existing component patterns
- Implement proper cleanup in useEffect
- Use TypeScript interfaces for component props
- Consider performance implications of rendering

### Terminal Integration
- Handle ANSI escape sequences properly
- Implement proper cleanup for terminal sessions
- Use proper error handling for command execution

### Database Operations
- Use parameterized queries
- Implement proper transaction handling
- Add appropriate indexes for performance
- Handle migration rollbacks

### Authentication System
- Never log sensitive information
- Implement proper token rotation
- Handle authentication state consistently
- Provide clear error messages

## Documentation Standards

### Code Documentation
- Add JSDoc/rustdoc comments for public APIs
- Include usage examples in documentation
- Document complex algorithms and business logic
- Keep comments up-to-date with code changes

### README Updates
- Update component READMEs for new features
- Include setup instructions for new dependencies
- Add troubleshooting entries for common issues

### API Documentation
- Document all endpoints with examples
- Include request/response schemas
- Add authentication requirements
- Provide SDK examples

## Getting Help

### Community Resources
- [Discord Server](https://discord.gg/Y3TFTmE89g) - General discussion and help
- [GitHub Discussions](https://github.com/your-org/ariana-ide/discussions) - Feature requests and design discussions
- [GitHub Issues](https://github.com/your-org/ariana-ide/issues) - Bug reports and tracked work

### Development Questions
- Check existing documentation first
- Search closed issues and discussions
- Ask specific questions with context
- Include code examples and error messages

### Code Review Process
- Reviews focus on code quality, security, and maintainability
- Expect constructive feedback and suggestions
- Reviewers will help improve your contribution
- Be patient - thorough reviews take time

## Release Process

### Version Management
- Follow semantic versioning (semver)
- Update version in package.json files
- Tag releases with git tags
- Update CHANGELOG.md

### Build and Distribution
- Test builds on all target platforms
- Verify installation processes
- Update distribution packages
- Coordinate release announcements

## Recognition

Contributors are recognized in:
- Git commit history
- Release notes for significant contributions
- CONTRIBUTORS.md file (when created)
- Community discussions and announcements

Thank you for contributing to the future of AI-powered development environments!