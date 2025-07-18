import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Category } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

export function ShopByCategory() {
  const [, navigate] = useLocation();
  
  const { data: categories, isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });
  
  const handleCategoryClick = (category: string) => {
    navigate(`/category/${encodeURIComponent(category)}`);
  };
  
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6">
        <h2 className="text-2xl font-medium mb-4">Shop by Category</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-lg p-4 h-40 flex flex-col items-center justify-center">
              <Skeleton className="h-20 w-20 rounded-lg mb-3" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  if (!categories || categories.length === 0) {
    return null;
  }
  
  return (
    <div className="bg-[#f5e7d4] py-8 shadow-lg rounded-xl mb-8">
      <div className="container mx-auto px-4">
        <h2 className="text-2xl md:text-3xl font-extrabold mb-6 text-black drop-shadow-sm">Shop by Category</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {categories.map((category) => (
            <div 
              key={category.id} 
              className="bg-white rounded-xl p-6 shadow-md cursor-pointer hover:shadow-xl transition-shadow border border-black/10 hover:scale-105"
              onClick={() => handleCategoryClick(category.name)}
            >
              <div className="flex flex-col items-center text-center h-full justify-between">
                <div className="flex-1 flex items-center justify-center mb-4">
                  {category.image ? (
                    <img 
                      src={category.image} 
                      alt={category.name} 
                      className="h-24 w-24 object-contain rounded-lg border border-yellow-200 bg-yellow-50"
                      onError={(e) => {
                        // Use a category-specific fallback image on error
                        const target = e.target as HTMLImageElement;
                        target.onerror = null; // Prevent infinite loop
                        // Use the simplified category-based placeholder
                        const categoryLower = category.name.toLowerCase();
                        target.src = `/images/${categoryLower}.svg`;
                      }}
                    />
                  ) : (
                    <div className="h-24 w-24 bg-yellow-100 rounded-lg flex items-center justify-center text-yellow-700 text-4xl border border-yellow-200">
                      {category.name.charAt(0)}
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-base text-black mt-2">{category.name}</h3>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}