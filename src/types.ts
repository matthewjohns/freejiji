export interface KijijiItem {
  id: string;
  title: string;
  description: string;
  image: string;
  rawImage?: string;
  actualPrice: number;
  isFree: boolean;
  listingUrl: string;
  location: string;
  correctCount?: number;
  totalCount?: number;
}
