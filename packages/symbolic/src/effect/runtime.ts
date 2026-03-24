import { Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { GitEffect } from "@/git/effect"

export const runtime = ManagedRuntime.make(Layer.mergeAll(AccountService.defaultLayer, GitEffect.defaultLayer))
