import { Package } from "./Package";

export interface LocalPackage extends Package {
  localPath: string
}