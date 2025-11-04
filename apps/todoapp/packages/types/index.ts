// TypeScript types for TodoApp

export interface ErrorResponse {
  success: false;
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
  created_at: Date;
}

export interface CreateUserRequest {
  email: string;
}

export interface CreateUserResponse {
  success: true;
  data: User;
}

export interface UsersResponse {
  success: true;
  data: User[];
  count: number;
}

export interface TodosResponse {
  success: true;
  data: Todo[];
  count: number;
}

export interface CreateProjectRequest {
  name: string;
  user_id: string;
}

export interface CreateProjectResponse {
  success: true;
  data: Project;
}

export interface ProjectsResponse {
  success: true;
  data: Project[];
  count: number;
}

