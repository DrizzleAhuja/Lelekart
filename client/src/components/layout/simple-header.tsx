import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Search,
  Menu,
  X,
  ShoppingCart,
  User,
  LogOut,
  ChevronDown,
  Mic,
  Home as HomeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SimpleSearch } from "@/components/ui/simple-search";
import { VoiceSearchDialog } from "@/components/search/voice-search-dialog";
import { AISearchService } from "@/services/ai-search-service";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/context/cart-context";

export function SimpleHeader() {
  const queryClient = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useLocation();

  // Use cart context for both guest and logged-in users
  const { cartItems } = useCart();

  // Use React Query to fetch user data
  const { data: user } = useQuery({
    queryKey: ["/api/user"],
    queryFn: async () => {
      const res = await fetch("/api/user", {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error("Failed to fetch user");
      }

      return res.json();
    },
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });

  // Get cart item count for notification badge (from context)
  const cartItemCount = cartItems.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0
  );

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      queryClient.setQueryData(["/api/user"], null);
      queryClient.setQueryData(["/api/cart"], []);
      setLocation("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Implement search functionality
    console.log("Search for:", searchQuery);
  };

  const navigateTo = (path: string) => {
    setLocation(path);
    setMobileMenuOpen(false);
  };

  const handleCartClick = () => {
    setLocation("/cart");
  };

  const getDashboardLink = () => {
    if (!user) return "/";
    if (user.role === "admin") return "/admin";
    if (user.role === "seller") return "/seller/dashboard";
    return "/buyer/dashboard";
  };

  return (
    <header className="bg-offwhite text-black sticky top-0 left-0 right-0 z-50 shadow-lg border-b border-cream font-sans" style={{fontFamily: 'Inter, Poppins, Arial, sans-serif'}}>
      {/* Desktop Header - with improved padding and spacing */}
      <div className="container mx-auto px-4 h-16 hidden md:flex md:items-center">
        <div className="flex items-center justify-between w-full py-2">
          <div className="flex items-center space-x-6">
            <Link href="/">
              <div className="flex items-center gap-2">
                {/* <img src="https://drive.google.com/thumbnail?id=1RNjADzUc3bRdEpavAv5lxcN1P9VLG-PC&sz=w1000" alt="Lelekart Logo" className="h-10 w-auto rounded-lg shadow-md border border-gray-200 bg-[#f5e7d4] p-1" /> */}
                <span className="text-3xl font-extrabold tracking-tight text-black">Lelekart</span>
              </div>
            </Link>
            <div className="flex-grow max-w-xl">
              <div className="bg-offwhite  px-3 py-1 flex items-center border border-cream shadow-inner">
                <SimpleSearch className="z-20 w-full text-black placeholder:text-gray-500" variant="default" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Hide Home button on home page */}
            {location !== "/" && (
              <Link href="/">
                <Button
                  variant="ghost"
                  className="flex items-center py-1 px-2 text-dark font-medium rounded-sm hover:bg-cream"
                  style={{ boxShadow: "none", background: "transparent" }}
                >
                  <HomeIcon className="mr-2 h-4 w-4" />
                  <span>Home</span>
                </Button>
              </Link>
            )}
            {!user ? (
              <a href="/auth" className="flex items-center py-2 px-5 bg-primary text-white font-semibold rounded-full shadow hover:bg-primary/90 transition">
                <User className="mr-2 h-5 w-5" />
                <span>Login</span>
              </a>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center py-2 px-5 bg-gray-100 text-primary font-semibold rounded-full shadow hover:bg-gray-200 transition">
                    <span>{user.name || user.username}</span>
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem asChild>
                    <Link href={getDashboardLink()} className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" /> 
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                    <span className="mr-2">🚪</span> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={handleCartClick}
              className="relative p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition shadow"
              title="Shopping Cart"
            >
              <ShoppingCart className="h-6 w-6 text-primary" />
              {cartItemCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center border-2 border-white shadow">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Remove or reduce margin below navbar for categories spacing */}
      {/* No extra div or margin here, category menu should appear immediately below */}

      {/* Mobile Header with improved spacing */}
      <div className="md:hidden px-4">
        <div className="h-14 flex items-center justify-between">
          <div className="flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-white hover:text-gray-200 mr-3 p-1"
              title="Open menu"
            >
              <Menu size={24} />
            </button>

            <Link href="/">
              <div className="flex items-center">
                <img
                  src="https://drive.google.com/thumbnail?id=1RNjADzUc3bRdEpavAv5lxcN1P9VLG-PC&sz=w1000"
                  alt="Lelekart Logo"
                  className="h-8 w-auto"
                />
              </div>
            </Link>
            {location !== "/" && (
              <Link href="/">
                <Button
                  variant="ghost"
                  className="flex items-center py-1 px-2 text-white font-medium rounded-sm hover:bg-primary-foreground/10"
                  style={{ boxShadow: "none", background: "transparent" }}
                >
                  <HomeIcon className="mr-2 h-4 w-4" />
                  <span>Home</span>
                </Button>
              </Link>
            )}
          </div>

          {(!user || user.role === "buyer") && (
            <button
              onClick={handleCartClick}
              className="text-white hover:text-gray-200 relative p-1"
              title="Shopping Cart"
            >
              <ShoppingCart className="h-5 w-5" />
              {cartItemCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-yellow-400 text-primary text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {cartItemCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Search - in a separate fixed position below the header */}
      <div className="md:hidden fixed top-14 left-0 right-0 bg-orange-400 px-4 pb-3 pt-1 z-40 shadow-md">
        <SimpleSearch />
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50">
          <div className="bg-orange-400 h-full w-3/4 max-w-xs p-5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Menu</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="text-white hover:text-gray-200 p-1"
                title="Close menu"
              >
                <X size={24} />
              </button>
            </div>

            <nav className="space-y-4">
              {location !== "/" && (
                <button
                  onClick={() => navigateTo("/")}
                  className="block w-full text-left py-3 border-b border-primary-foreground/20"
                >
                  Home
                </button>
              )}

              {!user ? (
                <button
                  onClick={() => navigateTo("/auth")}
                  className="block w-full text-left py-3 border-b border-primary-foreground/20"
                >
                  Login
                </button>
              ) : (
                <>
                  <button
                    onClick={() =>
                      navigateTo(
                        user.role === "admin"
                          ? "/admin"
                          : user.role === "seller"
                            ? "/seller/dashboard"
                            : "/buyer/dashboard"
                      )
                    }
                    className="block w-full text-left py-3 border-b border-primary-foreground/20"
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left py-3 border-b border-primary-foreground/20"
                  >
                    Logout
                  </button>
                </>
              )}

              {(!user || user.role === "buyer") && (
                <button
                  onClick={handleCartClick}
                  className="block w-full text-left py-3 border-b border-primary-foreground/20"
                  title="Shopping Cart"
                >
                  Cart {cartItemCount > 0 && `(${cartItemCount})`}
                </button>
              )}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
