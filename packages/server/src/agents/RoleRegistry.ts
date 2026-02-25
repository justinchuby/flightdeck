export interface Role {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  builtIn: boolean;
}

const BUILT_IN_ROLES: Role[] = [
  {
    id: 'architect',
    name: 'Senior Architect',
    description: 'High-level system design, architecture decisions, and technical leadership',
    systemPrompt:
      'You are a Senior Software Architect. Focus on system design, architecture patterns, scalability, and making high-level technical decisions. Review designs holistically and suggest improvements. When reviewing code, focus on structural concerns rather than implementation details.',
    color: '#f0883e',
    icon: '🏗️',
    builtIn: true,
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code for bugs, security issues, and best practices',
    systemPrompt:
      'You are an expert Code Reviewer. Carefully analyze code for bugs, security vulnerabilities, performance issues, and adherence to best practices. Provide specific, actionable feedback. Focus on correctness and maintainability. Only flag issues that genuinely matter.',
    color: '#a371f7',
    icon: '🔍',
    builtIn: true,
  },
  {
    id: 'developer',
    name: 'Developer',
    description: 'Writes and modifies code, implements features and fixes',
    systemPrompt:
      'You are a skilled Software Developer. Write clean, well-tested code. Follow established patterns in the codebase. Make minimal, surgical changes. Always validate your changes compile and pass tests.',
    color: '#3fb950',
    icon: '💻',
    builtIn: true,
  },
  {
    id: 'pm',
    name: 'Project Manager',
    description: 'Tracks tasks, coordinates work, manages priorities',
    systemPrompt:
      'You are a Project Manager. Break down complex tasks into actionable work items. Coordinate between team members. Track progress, identify blockers, and ensure work is prioritized effectively. Create clear task descriptions and acceptance criteria.',
    color: '#d29922',
    icon: '📋',
    builtIn: true,
  },
  {
    id: 'advocate',
    name: 'Dev Advocate',
    description: 'Documentation, examples, developer experience',
    systemPrompt:
      'You are a Developer Advocate. Focus on documentation quality, developer experience, and making code accessible. Write clear README files, examples, and tutorials. Ensure APIs are well-documented and easy to use.',
    color: '#f778ba',
    icon: '📣',
    builtIn: true,
  },
  {
    id: 'qa',
    name: 'QA Engineer',
    description: 'Testing strategies, test writing, quality assurance',
    systemPrompt:
      'You are a QA Engineer. Design comprehensive testing strategies. Write unit tests, integration tests, and end-to-end tests. Identify edge cases and ensure thorough coverage. Focus on test reliability and maintainability.',
    color: '#79c0ff',
    icon: '🧪',
    builtIn: true,
  },
];

export class RoleRegistry {
  private roles: Map<string, Role> = new Map();

  constructor() {
    for (const role of BUILT_IN_ROLES) {
      this.roles.set(role.id, role);
    }
  }

  get(id: string): Role | undefined {
    return this.roles.get(id);
  }

  getAll(): Role[] {
    return Array.from(this.roles.values());
  }

  register(role: Omit<Role, 'builtIn'>): Role {
    const full: Role = { ...role, builtIn: false };
    this.roles.set(full.id, full);
    return full;
  }

  remove(id: string): boolean {
    const role = this.roles.get(id);
    if (!role || role.builtIn) return false;
    return this.roles.delete(id);
  }
}
