import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';

async function resetAll() {
  const newPassword = 'tFczY9wyWabx'; 
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  await prisma.user.updateMany({
    data: { 
      passwordHash,
      mustChangePassword: true
    },
  });
  
  console.log(`✅ All users reset to default password`);
  await prisma.$disconnect();
}

resetAll().catch((e) => {
  console.error('Error', e);
  process.exit(1);
});
