import HRModulePage from '../../../src/features/human-resources/HRModulePage';
import { HUMAN_RESOURCES_MODULE_IDS } from '../../../src/features/human-resources/navigation';
import { notFound } from 'next/navigation';

export default async function Page({ params }) {
  const { module } = await params;
  if (!Object.values(HUMAN_RESOURCES_MODULE_IDS).includes(module)) notFound();
  return <HRModulePage moduleId={module} />;
}
