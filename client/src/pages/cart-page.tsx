import { Link, useLocation } from "wouter";
import { Minus, Plus, Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useContext } from "react";
import { AuthContext } from "@/hooks/use-auth";
import { User } from "@shared/schema";
import { useCart } from "@/context/cart-context";
import { Card } from "@/components/ui/card";

interface CartItem {
  id: number;
  quantity: number;
  userId?: number; // Make userId optional since guest cart items won't have it
  product: {
    id: number;
    name: string;
    description: string;
    price: number;
    image?: string;
    image_url?: string;
    imageUrl?: string;
    category: string;
    sellerId: number;
    approved: boolean;
    createdAt: string;
    images?: string;
    deliveryCharges?: number;
    isDealOfTheDay?: boolean;
    mrp?: number;
  };
  variant?: {
    id: number;
    productId: number;
    sku: string;
    price: number;
    mrp?: number;
    stock: number;
    color: string;
    size: string;
    images?: string;
  };
}

export default function CartPage() {
  const [, setLocation] = useLocation();
  const { cartItems, updateQuantity, removeFromCart, clearCart } = useCart();
  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: 60000,
  });
  const isLoading = false;

  const proceedToCheckout = () => {
    // If user is not logged in, redirect to auth with return URL
    if (!user) {
      setLocation("/auth?returnUrl=/checkout", { replace: false });
      return;
    }
    // Otherwise proceed to checkout
    setLocation("/checkout", { replace: false });
  };

  // Calculate totals - use deal price if isDealOfTheDay, else variant price if available
  const subtotal = cartItems.reduce((total, item) => {
    let price;
    if (item.product.isDealOfTheDay) {
      price = item.product.price;
    } else {
      price = item.variant ? item.variant.price : item.product.price;
    }
    return total + price * item.quantity;
  }, 0);
  // Calculate delivery charges for all items
  const deliveryCharges = cartItems.reduce((total, item) => {
    const charge = item.product.deliveryCharges ?? 0;
    return total + charge * item.quantity;
  }, 0);
  const total = subtotal + deliveryCharges;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-4">Your cart is empty</h2>
          <p className="text-gray-600 mb-8">
            Looks like you haven't added any items to your cart yet.
          </p>
          <Button
            onClick={() => setLocation("/", { replace: false })}
            className="bg-primary text-white"
          >
            Continue Shopping
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-2 sm:px-4 bg-offwhite">
      <h1 className="text-2xl font-bold mb-8 text-center sm:text-left">
        Shopping Cart
      </h1>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Cart Items */}
        <div className="w-full md:w-2/3">
          <div className="bg-offwhite rounded-lg shadow-md p-2 sm:p-6 border border-gray-200">
            <div className="flow-root">
              <ul className="-my-6 divide-y divide-gray-200">
                {cartItems.map((item, idx) => (
                  <li
                    key={item.id}
                    className="py-6 flex flex-col sm:flex-row gap-4 sm:gap-0"
                  >
                    <div className="flex-shrink-0 w-full sm:w-24 h-40 sm:h-24 border border-gray-200 rounded-md overflow-hidden mx-auto sm:mx-0">
                      <img
                        src={
                          item.product.imageUrl ||
                          "/images/categories/fashion.svg"
                        }
                        alt={item.product.name}
                        className="w-full h-full object-center object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.onerror = null;
                          if (item.product.category) {
                            const categoryLower =
                              item.product.category.toLowerCase();
                            target.src = `../images/${categoryLower}.svg`;
                          } else {
                            target.src = "../images/placeholder.svg";
                          }
                        }}
                      />
                    </div>

                    <div className="sm:ml-4 flex-1 flex flex-col justify-between w-full">
                      <div>
                        <div className="flex flex-col sm:flex-row justify-between text-base font-medium text-gray-900 gap-2">
                          <h3 className="text-center sm:text-left">
                            <Link
                              href={`/product/${item.product.id}`}
                              className="hover:text-primary"
                            >
                              {item.product.name}
                            </Link>
                          </h3>
                          <div className="flex items-center gap-2 justify-center sm:justify-end">
                            {item.product.isDealOfTheDay ? (
                              <>
                                <span>₹{item.product.price}</span>
                                {item.product.mrp && (
                                  <span className="text-gray-400 text-xs line-through ml-1">
                                    ₹{item.product.mrp}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span>
                                ₹
                                {item.variant
                                  ? item.variant.price
                                  : item.product.price}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-sm text-gray-500 text-center sm:text-left">
                          {item.product.category}
                        </p>
                        {/* Display variant details if available */}
                        {item.variant && (
                          <div className="mt-1 flex flex-wrap gap-1 justify-center sm:justify-start">
                            {item.variant.color && (
                              <span className="inline-block px-2 py-0.5 bg-gray-100 rounded-sm text-xs">
                                Color: {item.variant.color}
                              </span>
                            )}
                            {item.variant.size && (
                              <span className="inline-block px-2 py-0.5 bg-gray-100 rounded-sm text-xs">
                                Size: {item.variant.size}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row items-center justify-between text-sm mt-4 gap-2">
                        <div className="flex items-center border rounded-md mx-auto sm:mx-0">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-l"
                            onClick={() =>
                              updateQuantity(
                                user && item.id !== undefined ? item.id : idx,
                                Math.max(1, item.quantity - 1)
                              )
                            }
                            disabled={item.quantity <= 1}
                            title="Decrease quantity"
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-10 h-8 bg-white flex items-center justify-center text-base border-t border-b">
                            {item.quantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-r"
                            onClick={() =>
                              updateQuantity(
                                user && item.id !== undefined ? item.id : idx,
                                item.quantity + 1
                              )
                            }
                            title="Increase quantity"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 mt-2 sm:mt-0"
                          onClick={() =>
                            removeFromCart(
                              user && item.id !== undefined ? item.id : idx
                            )
                          }
                          title="Remove from cart"
                        >
                          <Trash2 className="h-5 w-5" /> Remove
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
              <Link href="/" className="w-full sm:w-auto">
                <Button variant="ghost" className="w-full sm:w-auto">
                  Continue Shopping
                </Button>
              </Link>
            </div>
          </div>
        </div>
        {/* Summary */}
        <div className="w-full md:w-1/3">
          <div className="bg-offwhite rounded-lg shadow-md p-4 sm:p-6 sticky top-24 border border-gray-200">
            {/* Move Clear Cart button here */}
            <Button
              variant="outline"
              className="w-full mb-4"
              onClick={clearCart}
            >
              Clear Cart
            </Button>
            <h2 className="text-lg font-semibold mb-4 text-center sm:text-left">
              Order Summary
            </h2>
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>₹{subtotal}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Delivery Charges</span>
                <span>₹{deliveryCharges}</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t pt-2">
                <span>Total</span>
                <span>₹{total}</span>
              </div>
            </div>
            <Button
              className="w-full text-base py-3"
              onClick={proceedToCheckout}
            >
              Proceed to Checkout <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
