// User entity interface
export interface UserInterface {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

// Response types
export interface UserResponse {
  data: UserInterface | UserInterface[];
}

export interface ErrorResponse {
  success: false;
  error: string;
}
