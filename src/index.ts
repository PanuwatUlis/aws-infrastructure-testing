import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

/**
 * Per NodeGroup IAM: each NodeGroup will bring its own, specific instance role and profile.
 */

 const managedPolicyArns: string[] = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
];

// Creates a role and attaches the EKS worker node IAM managed policies. Used a few times below,
// to create multiple roles, so we use a function to avoid repeating ourselves.
export function createRole(name: string): aws.iam.Role {
    const role = new aws.iam.Role(name, {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ec2.amazonaws.com",
        }),
    });

    let counter = 0;
    for (const policy of managedPolicyArns) {
        // Create RolePolicyAttachment without returning it.
        const rpa = new aws.iam.RolePolicyAttachment(`${name}-policy-${counter++}`,
            { policyArn: policy, role: role },
        );
    }

    return role;
}

// Now create the roles and instance profiles for the two worker groups.
const role1 = createRole("my-worker-role1");
const instanceProfile1 = new aws.iam.InstanceProfile("my-instance-profile1", {role: role1});

//Create VPC
const vpc = new awsx.ec2.Vpc("my-vpc", {
    cidrBlock: "10.0.0.0/16",
});

// Create an EKS cluster with many IAM roles to register with the cluster auth.
const cluster = new eks.Cluster("my-cluster", {
    vpcId: vpc.id,
    subnetIds: vpc.publicSubnetIds,
    skipDefaultNodeGroup: true,
    instanceRoles: [role1],
});

// First, create a node group for fixed compute.
const fixedNodeGroup = cluster.createNodeGroup("my-cluster-ng1", {
    instanceType: "t2.medium",
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 3,
    labels: {"ondemand": "true"},
    instanceProfile: instanceProfile1,
});

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;

// Create argo cd thourgh yaml file.
const argocd = new k8s.yaml.ConfigFile("argocd", {
    file: "argocd-install.yaml",
}, {provider: cluster.provider});