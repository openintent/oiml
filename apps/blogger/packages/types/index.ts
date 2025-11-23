// User types
export interface UserInterface {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface UserResponse {
  data: UserInterface | UserInterface[];
}

// Event types
export interface EventInterface {
  id: string;
  title: string;
}

export interface EventResponse {
  data: EventInterface | EventInterface[];
}

// Room types
export interface RoomInterface {
  id: string;
  created_at: Date;
}

export interface RoomResponse {
  data: RoomInterface | RoomInterface[];
}

// Error response type
export interface ErrorResponse {
  success: false;
  error: string;
}
