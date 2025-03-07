import * as camelcase from 'camelcase';
import * as reflect from 'jsii-reflect';
import { CoreTypes } from './core-types';
import { ResourceReflection } from './resource';
import { Linter } from '../linter';

const cfnResourceTagName = 'cloudformationResource';

// this linter verifies that we have L2 coverage. it finds all "Cfn" classes and verifies
// that we have a corresponding L1 class for it that's identified as a resource.
export const cfnResourceLinter = new Linter(a => CfnResourceReflection.findAll(a));

// Cache L1 constructs per type system.
const l1ConstructCache = new Map<reflect.TypeSystem, Map<string, reflect.ClassType>>();

function cacheL1ConstructsForTypeSystem(sys: reflect.TypeSystem) {
  if (!l1ConstructCache.has(sys)) {
    l1ConstructCache.set(sys, new Map<string, reflect.ClassType>());

    for (const cls of sys.classes) {
      const cfnResourceTag = cls.docs.customTag(cfnResourceTagName);

      if (cfnResourceTag) {
        l1ConstructCache.get(sys)?.set(cfnResourceTag?.toLocaleLowerCase()!, cls);
      }
    }
  }
}

cfnResourceLinter.add({
  code: 'resource-class',
  message: 'every resource must have a resource class (L2), add \'@resource %s\' to its docstring',
  warning: true,
  eval: e => {
    const l2 = ResourceReflection.findAll(e.ctx.classType.assembly).find(r => r.cfn.fullname === e.ctx.fullname);
    e.assert(l2, e.ctx.fullname, e.ctx.fullname);
  },
});

export class CfnResourceReflection {
  /**
   * Finds a Cfn resource class by full CloudFormation resource name (e.g. `AWS::S3::Bucket`)
   * @param fullName first two components are case-insensitive (e.g. `aws::s3::Bucket` is equivalent to `Aws::S3::Bucket`)
   */
  public static findByName(sys: reflect.TypeSystem, fullName: string) {
    if (!l1ConstructCache.has(sys)) {
      cacheL1ConstructsForTypeSystem(sys);
    }

    const cls = l1ConstructCache.get(sys)?.get(fullName.toLowerCase());
    if (cls) {
      return new CfnResourceReflection(cls);
    }

    return undefined;
  }

  /**
   * Returns all CFN resource classes within an assembly.
   */
  public static findAll(assembly: reflect.Assembly) {
    return assembly.allClasses
      .filter(c => CoreTypes.isCfnResource(c))
      .map(c => new CfnResourceReflection(c));
  }

  public readonly classType: reflect.ClassType;
  public readonly fullname: string; // AWS::S3::Bucket
  public readonly namespace: string; // AWS::S3
  public readonly basename: string; // Bucket
  public readonly attributeNames: string[]; // (normalized) bucketArn, bucketName, queueUrl
  public readonly doc: string; // link to CloudFormation docs

  constructor(cls: reflect.ClassType) {
    this.classType = cls;

    this.basename = cls.name.slice('Cfn'.length);

    const fullname = cls.docs.customTag('cloudformationResource');
    if (!fullname) {
      throw new Error(`Unable to extract CloudFormation resource name from initializer documentation of ${cls}`);
    }

    this.fullname = fullname;

    this.namespace = fullname.split('::').slice(0, 2).join('::');

    this.attributeNames = cls.ownProperties
      .filter(p => (p.docs.docs.custom || {}).cloudformationAttribute)
      .map(p => p.docs.customTag('cloudformationAttribute') || '<error>')
      .map(p => this.attributePropertyNameFromCfnName(p));

    this.doc = cls.docs.docs.see || '';
  }

  private attributePropertyNameFromCfnName(name: string): string {

    // special case (someone was smart), special case copied from spec2cdk
    if (this.basename === 'SecurityGroup' && name === 'GroupId') {
      return 'Id';
    }

    return camelcase(name, { pascalCase: true });
  }
}
