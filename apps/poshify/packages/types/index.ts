// User entity interface
export interface UserInterface {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

// Product entities
export interface CategoryInterface {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductInterface {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  created_at: Date;
  updated_at: Date;
}

export interface ProductVariantInterface {
  id: string;
  product_id: string;
  title: string;
  sku: string | null;
  price: number;
  compare_at_price: number | null;
  inventory_quantity: number;
  weight: number | null;
  weight_unit: "kg" | "lb" | "oz" | "g" | null;
  barcode: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductImageInterface {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  position: number;
  created_at: Date;
}

// Customer entities
export interface CustomerInterface {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  accepts_marketing: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AddressInterface {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

// Order entities
export interface OrderInterface {
  id: string;
  order_number: string;
  customer_id: string | null;
  email: string;
  financial_status: "pending" | "authorized" | "partially_paid" | "paid" | "partially_refunded" | "refunded" | "voided";
  fulfillment_status: "unfulfilled" | "partial" | "fulfilled" | "restocked";
  subtotal_price: number;
  total_tax: number;
  total_discounts: number;
  total_price: number;
  currency: string;
  shipping_address_id: string | null;
  billing_address_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemInterface {
  id: string;
  order_id: string;
  product_variant_id: string;
  title: string;
  quantity: number;
  price: number;
  sku: string | null;
  created_at: Date;
}

// Cart entities
export interface CartInterface {
  id: string;
  customer_id: string | null;
  session_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CartItemInterface {
  id: string;
  cart_id: string;
  product_variant_id: string;
  quantity: number;
  created_at: Date;
  updated_at: Date;
}

// Response types
export interface UserResponse {
  data: UserInterface | UserInterface[];
}

export interface CategoryResponse {
  data: CategoryInterface | CategoryInterface[];
}

export interface ProductResponse {
  data: ProductInterface | ProductInterface[];
}

export interface ProductVariantResponse {
  data: ProductVariantInterface | ProductVariantInterface[];
}

export interface ProductImageResponse {
  data: ProductImageInterface | ProductImageInterface[];
}

export interface CustomerResponse {
  data: CustomerInterface | CustomerInterface[];
}

export interface AddressResponse {
  data: AddressInterface | AddressInterface[];
}

export interface OrderResponse {
  data: OrderInterface | OrderInterface[];
}

export interface OrderItemResponse {
  data: OrderItemInterface | OrderItemInterface[];
}

export interface CartResponse {
  data: CartInterface | CartInterface[];
}

export interface CartItemResponse {
  data: CartItemInterface | CartItemInterface[];
}

export interface ErrorResponse {
  success: false;
  error: string;
}
