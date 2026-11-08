// TypeScript types for TodoApp

export interface ErrorResponse {
  error: string;
}

export interface Todo {
  id: string;
  description: string;
  completed: boolean;
  created_at: Date;
  user_id: string;
  project_id: string | null;
}

export interface User {
  id: string;
  email: string;
  created_at: Date;
}

export interface Project {
  id: string;
  user_id: string;
  name: string | null;
  description: string | null;
  created_at: Date;
}

export interface CreateUserRequest {
  email: string;
}

export interface CreateUserResponse {
  data: User;
}

export interface UsersResponse {
  data: User[];
}

export interface TodosResponse {
  data: Todo[];
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  user_id: string;
}

export interface CreateProjectResponse {
  data: Project;
}

export interface ProjectsResponse {
  data: Project[];
}
