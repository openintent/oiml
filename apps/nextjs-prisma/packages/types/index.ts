// TypeScript types for Posty

export interface ErrorResponse {
  error: string;
}

// User entity
export interface UserInterface {
  id: string;
  email: string;
}

export interface UserResponse {
  data: UserInterface | UserInterface[];
}

