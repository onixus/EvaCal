import { requireRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import CatalogPanel from '@/components/CatalogPanel';
export default async function CatalogPage() {
  await requireRole(CATALOG_ROLES, '/catalog');
  return (
    <div className="page">
      <h1 className="text-xl font-bold">Каталог поставки</h1>
      <CatalogPanel />
    </div>
  );
}
