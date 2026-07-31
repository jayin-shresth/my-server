import { InMemoryPharmacyRepository } from './pharmacy.repository.js';
import { PharmacyService } from './pharmacy.service.js';

/**
 * Module-level singleton. This is the only place PharmacyRepository is
 * constructed. Swap InMemoryPharmacyRepository for the SQLite
 * implementation here once it exists — pharmacy.tools.ts never changes.
 *
 * Wiring lives here (not in PharmacyTools' constructor) because NitroStack
 * appears to instantiate tool classes itself with no arguments (see
 * CalculatorTools, which has no constructor). A required constructor
 * parameter on PharmacyTools would break that instantiation, so injection
 * happens via this shared instance instead.
 */
const pharmacyRepository = new InMemoryPharmacyRepository();
export const pharmacyService = new PharmacyService(pharmacyRepository);