const assert = require("assert");
const sinon = require("sinon");
const { StateActuator, Subscription } = require("../lib/index");

function delay(value) {
  return new Promise((resolve) => setTimeout(resolve, 10, value));
}

describe("StateActuator", function () {
  const stateful = {
    init() {
      return { data: ["init"], changeCount: 0 };
    },
    update(model, msg) {
      switch (msg.type) {
        case "AddData":
          return { data: model.data.concat(msg.value), changeCount: model.changeCount + 1 };

        case "ClearData":
          return { data: [], changeCount: model.changeCount + 1 };

        case "LoadData":
          return [model, delay({ type: "LoadDataSuccess", data: ["a", "b", "c"] })];

        case "LoadDataSuccess":
          return { data: msg.data, changeCount: model.changeCount + 1 };
      }
    },
  };

  describe("Basic message processing", () => {
    it("calls the init function to setup initial state", () => {
      const actuator = StateActuator(stateful);
      assert(actuator.initialModel.data[0] === "init");
      assert(actuator.initialModel.changeCount === 0);
    });

    it("calls the update function to process messages", async () => {
      const actuator = StateActuator(stateful);
      const iterator = actuator.stateIterator();

      actuator.updater({ type: "AddData", value: "New York" });
      actuator.updater({ type: "ClearData" });
      actuator.updater({ type: "AddData", value: "Rhode Island" });

      assert.deepStrictEqual(await iterator.next(), {
        done: false,
        value: { data: ["init", "New York"], changeCount: 1 },
      });
      assert.deepStrictEqual(await iterator.next(), {
        done: false,
        value: { data: [], changeCount: 2 },
      });
      assert.deepStrictEqual(await iterator.next(), {
        done: false,
        value: { data: ["Rhode Island"], changeCount: 3 },
      });
    });
  });

  describe("Async message processing", () => {
    it("handles model and messages from the update function", async () => {
      const actuator = StateActuator(stateful);
      const iterator = actuator.stateIterator();

      actuator.updater({ type: "AddData", value: "New York" });
      actuator.updater({ type: "LoadData" });

      assert.deepStrictEqual(await iterator.next(), {
        done: false,
        value: { data: ["init", "New York"], changeCount: 1 },
      });
      assert.deepStrictEqual(await iterator.next(), {
        done: false,
        value: { data: ["a", "b", "c"], changeCount: 2 },
      });
    });
  });

  describe("Using Context", () => {
    const actuator = StateActuator({
      context: () => 1000,
      init: (context) => ({ state: context }),
      update: (model, _, context) => {
        // Keep adding context to indicate it worked
        return { state: model.state + context };
      },
    });
    const iterator = actuator.stateIterator();

    it("passes context to the 'init()' function", () => {
      assert(actuator.initialModel.state === 1000);
    });

    it("passes context to the 'update()' function", async () => {
      actuator.updater({ type: "DoSomething" });
      actuator.updater({ type: "DoSomething" });

      const result1 = await iterator.next();
      const result2 = await iterator.next();

      assert(result1.value.state === 2000);
      assert(result2.value.state === 3000);
    });
  });

  describe("Subscription processing", () => {
    it("calls the subscription every time the model changes", async () => {
      // This subscribe function just tracks calls
      const subscribeFunc = sinon.fake();
      const subscribe = sinon.fake.returns(Subscription(subscribeFunc));

      const actuator = StateActuator({ ...stateful, subscribe });
      const iterator = actuator.stateIterator();

      let asyncResult = iterator.next();
      assert(subscribe.calledOnce);
      assert(subscribeFunc.calledOnceWith(actuator.updater));

      actuator.updater({ type: "AddData", value: "New York" });
      actuator.updater({ type: "AddData", value: "Philadelphia" });

      let newModel = await asyncResult;
      assert(subscribe.callCount == 2);

      newModel = await iterator.next();
      assert(subscribe.callCount == 3);
    });

    it("uses keys to determine when to remove the subscription", async () => {
      const subscribeRemove = sinon.fake();

      function subscribe(model) {
        return Subscription(
          (_) => {
            return subscribeRemove;
          },
          [model.changeCount]
        );
      }

      const actuator = StateActuator({ ...stateful, subscribe });
      const iterator = actuator.stateIterator();

      let asyncResult = iterator.next();

      // Send some messages
      actuator.updater({ type: "AddData", value: "New York" });
      actuator.updater({ type: "AddData", value: "Philadelphia" });
      actuator.updater({ type: "AddData", value: "Baltimore" });

      let newModel = await asyncResult;
      assert(subscribeRemove.callCount == 1);

      newModel = await iterator.next();
      assert(subscribeRemove.callCount == 2);

      newModel = await iterator.next();
      assert(subscribeRemove.callCount == 3);
    });
  });
});
