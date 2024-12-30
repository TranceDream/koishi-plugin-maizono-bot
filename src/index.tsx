import { Context, Logger, Schema } from "koishi";
import fetch, { Response } from "node-fetch";
import * as cheerio from "cheerio";
import * as Minio from "minio";

export const name = "maizono-bot";

export interface Config {
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucketName: string;
  quotesDir: string;
}

export const Config: Schema<Config> = Schema.object({
  endPoint: Schema.string().required().description("MinIO Endpoint"),
  port: Schema.number()
    .min(1025)
    .max(65535)
    .required()
    .description("MinIO端口"),
  accessKey: Schema.string().required().description("MinIO Access Key"),
  secretKey: Schema.string()
    .role("secret")
    .required()
    .description("MinIO Secret Key"),
  useSSL: Schema.boolean().default(false).description("是否使用SSL"),
  bucketName: Schema.string().default(name).description("Bucket名称"),
  quotesDir: Schema.string().default("").description("对象存储路径(前缀)"),
});

const logger: Logger = new Logger(name);

export function apply(ctx: Context, config: Config) {
  /* ================================================================================ */
  // 生成对象uri时的协议，通过配置项useSSL决定
  const minioProtocol: "https" | "http" = config.useSSL ? "https" : "http";
  // minio客户端
  const minioClient: Minio.Client = new Minio.Client({
    endPoint: config.endPoint, // MinIO 服务地址
    port: config.port, // MinIO 服务端口
    useSSL: config.useSSL, // 是否使用 HTTPS
    accessKey: config.accessKey, // MinIO 的访问密钥
    secretKey: config.secretKey, // MinIO 的访问密钥
  });

  /* ================================================================================ */
  /**
   * 从疼讯服务器下载图片，并上传到minio中
   * @param {string} src 图片原始uri
   * @returns {Promise<string>} minio对象uri
   */
  const fetchAndUploadImages = async (src: string): Promise<string> => {
    // 下载图片资源并获取Buffer
    const response: Response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const buffer: Buffer<ArrayBufferLike> = Buffer.from(
      await response.arrayBuffer()
    );

    // 从原始uri中获取fileid生成新文件名
    const fileName: string = `${config.quotesDir}${Date.now()}-${
      new URLSearchParams(src.split("?")[1]).get("fileid") ?? "undefined"
    }`;

    // 上传到minio
    await minioClient.putObject(config.bucketName, fileName, buffer);

    logger.info(`上传语录 - 成功上传: ${fileName}`);
    return `${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${fileName}`;
  };

  /* ================================================================================ */
  // 上传语录 - 支持连续发送图片
  ctx
    .command("上传语录")
    .usage('支持连续发送图片，回复"结束"结束上传')
    .action(async (argv) => {
      const { session } = argv;
      await session.send('发送图片开始上传，回复"结束"结束上传');

      // 获取原始输入
      const rawInputs: string[] = [];
      while (true) {
        const content: string = await session.prompt();
        if (!content || content == "结束") {
          break;
        }
        rawInputs.push(content);
      }

      // 获取原始输入元素图片src，过滤非图元素
      const inputs: string[] = rawInputs
        .map((rr) => {
          const $ = cheerio.load(rr);
          const src = $("img").attr("src");
          return src;
        })
        .filter((item) => item != null);

      // 轮流上传，获取上传后对象uri
      const results: string[] = (
        await Promise.allSettled(
          inputs.map((e) =>
            fetchAndUploadImages(e).catch((error) => {
              logger.error(`上传语录 - ${error}`);
              session.send(error);
              return null;
            })
          )
        )
      )
        .filter(({ status }) => status == "fulfilled")
        .map((e) => (e as PromiseFulfilledResult<string>).value);

      return `试图上传${inputs.length}张图片\n上传成功${results.length}张图片`;
    });

  /* ================================================================================ */
  // 语录 - 随机抽取一张语录图
  ctx
    .command("语录")
    .usage("随机抽取一张语录图")
    .action(async (argv) => {
      const { session } = argv;

      // 获取所有文件名
      const quotes: Minio.BucketItem[] = await new Promise(
        (resolve, reject) => {
          const objects: Minio.BucketItem[] = [];
          const stream: Minio.BucketStream<Minio.BucketItem> =
            minioClient.listObjectsV2(
              config.bucketName,
              config.quotesDir,
              true
            );
          stream.on("data", (obj) => objects.push(obj));
          stream.on("end", () => resolve(objects));
          stream.on("error", (err) => reject(err));
        }
      );

      // 抽一个
      const randomQuote: string =
        quotes[Math.floor(Math.random() * quotes.length)].name;
      logger.info(`语录 - 抽取: ${randomQuote}`);
      session.send(
        <img
          src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${randomQuote}`}
        />
      );
    });

  /* ================================================================================ */
  // 语录十连 - 随机抽取十张语录图
  ctx
    .command("语录十连")
    .usage("随机抽取十张语录图")
    .action(async (argv) => {
      const { session } = argv;

      // 获取所有文件名
      const quotes: Minio.BucketItem[] = await new Promise(
        (resolve, reject) => {
          const objects: Minio.BucketItem[] = [];
          const stream: Minio.BucketStream<Minio.BucketItem> =
            minioClient.listObjectsV2(
              config.bucketName,
              config.quotesDir,
              true
            );
          stream.on("data", (obj) => objects.push(obj));
          stream.on("end", () => resolve(objects));
          stream.on("error", (err) => reject(err));
        }
      );

      // 集合去重
      const randomQuoteSet: Set<string> = new Set();
      while (randomQuoteSet.size < 10) {
        randomQuoteSet.add(
          quotes[Math.floor(Math.random() * quotes.length)].name
        );
      }

      // 防止消息轰炸，放到同一个Fragment下发送
      session.send(
        <>
          {Array.from(randomQuoteSet).map((quote) => (
            <img
              src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${quote}`}
            />
          ))}
        </>
      );
    });

  /* ================================================================================ */
  // 对象查看 - debug使用，预览minio中图片
  ctx
    .command("对象查看")
    .usage("调试用，预览图片，后接相对路径")
    .action(async (argv, message) => {
      const { session } = argv;
      session.send(
        <img
          src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${message}`}
        />
      );
    });
}
