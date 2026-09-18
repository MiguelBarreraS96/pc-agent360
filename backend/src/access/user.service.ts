import type { Firestore } from "firebase-admin/firestore";

import { conflict, notFound } from "../errors";

import type { AuthorizedUser, Role } from "./access.models";
import type { CreateUserInput, UpdateUserInput } from "./access.schemas";
import { RoleRepository } from "./role.repository";
import { UserRepository } from "./user.repository";

/** Apply whitelist and administrator-continuity rules for user administration. */
export class UserService {
  public constructor(
    private readonly firestore: Firestore,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
  ) {}

  /** Create an active whitelist user with USER as the safe default role. */
  public async createUser(input: CreateUserInput): Promise<AuthorizedUser> {
    if ((await this.userRepository.findByEmail(input.email)) !== null) {
      throw conflict();
    }

    const roleId = input.roleId === undefined ? null : (await this.requireRole(input.roleId)).id;
    return this.userRepository.create({
      displayName: input.displayName ?? null,
      email: input.email,
      roleId,
    });
  }

  /** Delete a user after atomically preserving an active administrator. */
  public async deleteUser(userId: string, actorUserId: string): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      const userRepository = new UserRepository(this.firestore, transaction);
      await userRepository.lockAdministratorContinuity();

      const user = await this.requireUser(userId, userRepository);
      this.rejectSelfDeletion(user.id, actorUserId);
      await this.ensureAdministratorContinuity(user, false, userRepository);

      if (!(await userRepository.delete(user.id))) {
        throw notFound();
      }
    });
  }

  /** Return one whitelisted user. */
  public async getUser(userId: string): Promise<AuthorizedUser> {
    return this.requireUser(userId);
  }

  /** Return all whitelisted users. */
  public async listUsers(): Promise<readonly AuthorizedUser[]> {
    return this.userRepository.list();
  }

  /** Update a user while atomically retaining at least one active ADMIN. */
  public async updateUser(
    userId: string,
    input: UpdateUserInput,
    actorUserId: string,
  ): Promise<AuthorizedUser> {
    return this.firestore.runTransaction(async (transaction) => {
      const userRepository = new UserRepository(this.firestore, transaction);
      const roleRepository = new RoleRepository(this.firestore, transaction);
      await userRepository.lockAdministratorContinuity();

      const existingUser = await this.requireUser(userId, userRepository);
      const nextRole =
        input.roleId === undefined ? existingUser.role : await this.requireRole(input.roleId, roleRepository);
      const nextUser: AuthorizedUser = {
        ...existingUser,
        displayName: input.displayName === undefined ? existingUser.displayName : input.displayName,
        email: input.email ?? existingUser.email,
        isActive: input.isActive ?? existingUser.isActive,
        role: nextRole,
      };

      this.rejectSelfDeactivation(nextUser, actorUserId);
      const remainsActiveAdministrator = nextUser.isActive && this.hasProtectedAdministratorRole(nextUser);
      await this.ensureAdministratorContinuity(existingUser, remainsActiveAdministrator, userRepository);
      return userRepository.update(nextUser);
    });
  }

  /** Ensure a role exists before assigning it to a user. */
  private async requireRole(roleId: string, roleRepository = this.roleRepository): Promise<Role> {
    const role = await roleRepository.findById(roleId);
    if (role === null) {
      throw notFound();
    }

    return role;
  }

  /** Ensure a target whitelist user exists. */
  private async requireUser(userId: string, userRepository = this.userRepository): Promise<AuthorizedUser> {
    const user = await userRepository.findById(userId);
    if (user === null) {
      throw notFound();
    }

    return user;
  }

  /** Avoid a user deleting their own authenticated administration path. */
  private rejectSelfDeletion(targetUserId: string, actorUserId: string): void {
    if (targetUserId === actorUserId) {
      throw conflict();
    }
  }

  /** Avoid an administrator disabling or demoting their own active session identity. */
  private rejectSelfDeactivation(nextUser: AuthorizedUser, actorUserId: string): void {
    if (nextUser.id === actorUserId && (!nextUser.isActive || !this.hasProtectedAdministratorRole(nextUser))) {
      throw conflict();
    }
  }

  /** Check that a role is the protected administrator role rather than a similarly named custom role. */
  private hasProtectedAdministratorRole(user: AuthorizedUser): boolean {
    return user.role.key === "ADMIN" && user.role.isProtected;
  }

  /** Preserve at least one active protected ADMIN while all access mutations share one transaction lock. */
  private async ensureAdministratorContinuity(
    previousUser: AuthorizedUser,
    remainsActiveAdministrator: boolean,
    userRepository: UserRepository,
  ): Promise<void> {
    const removesActiveAdministrator =
      previousUser.isActive &&
      this.hasProtectedAdministratorRole(previousUser) &&
      !remainsActiveAdministrator;
    if (!removesActiveAdministrator) {
      return;
    }

    if ((await userRepository.countActiveAdministratorsExcluding(previousUser.id)) === 0) {
      throw conflict();
    }
  }
}
